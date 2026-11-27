'use strict';

// ============================================================================================
// MISSION 11 · SOUS-PROMPT 2 — Affectations multiples du personnel.
//
// Un membre d'équipe peut être responsable de plusieurs tables et de plusieurs salons.
// Une même table peut être partagée par plusieurs membres : la règle « UNE table = UNE
// responsable » de la mission 6 reste utilisée pour la seule affectation PRINCIPALE (celle qui
// reçoit automatiquement les commandes de la table). Les affectations supplémentaires sont
// déclaratives : elles servent au marchand à organiser son personnel, et elles sont historisées.
//
// Rien n'est supprimé : l'ancienne table `team_service_point_assignments` continue de porter
// l'affectation principale. La nouvelle table porte TOUTES les affectations (y compris
// principales) et l'historique complet.
// ============================================================================================

module.exports = function createTeamAssignments({ team, ops }) {
  const isPg = () => Boolean(team && team.pg && team.base && team.base.pool);
  const pool = () => team.base.pool;

  function newId() {
    return `tspm_${require('node:crypto').randomBytes(10).toString('hex')}`;
  }

  function fail(message, code = 'ASSIGNMENT_ERROR', status = 400) {
    const error = new Error(message); error.code = code; error.status = status; return error;
  }

  // Les identifiants arrivent sous forme de liste : on nettoie, on dédouble, on ignore le vide.
  function uniqueIds(list) {
    const values = Array.isArray(list) ? list : (list === undefined || list === null ? [] : [list]);
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  async function pointsOfStore(storeId) {
    if (isPg()) {
      const { rows } = await pool().query(
        `SELECT id, name, zone, point_type AS type, status, public_code AS "publicCode"
           FROM merchant_service_points WHERE store_id=$1 ORDER BY point_type, name`, [storeId]);
      return rows;
    }
    return (team.base.state?.merchantServicePoints || []).filter((row) => row.storeId === storeId);
  }

  // ------------------------------------------------------------------ lecture d'une affectation
  async function forMember(merchantId, memberId) {
    if (!isPg()) {
      const rows = team.base.state?.teamMemberServicePoints || [];
      return rows.filter((row) => row.merchantId === merchantId && row.memberId === memberId);
    }
    const { rows } = await pool().query(
      `SELECT a.id, a.service_point_id AS "servicePointId", a.member_id AS "memberId",
              a.is_primary AS "isPrimary", a.assigned_at AS "assignedAt", a.assigned_by_type AS "assignedByType",
              p.name, p.zone, p.point_type AS type, p.status, p.public_code AS "publicCode"
         FROM team_member_service_points a
         JOIN merchant_service_points p ON p.id=a.service_point_id
        WHERE a.merchant_id=$1 AND a.member_id=$2
        ORDER BY a.is_primary DESC, p.point_type, p.name`, [merchantId, memberId]);
    return rows;
  }

  // Vue d'ensemble pour l'écran « Mon équipe » : un membre = la liste de ses espaces.
  async function mapByMember(merchantId) {
    const map = new Map();
    if (isPg()) {
      const { rows } = await pool().query(
        `SELECT a.member_id AS "memberId", a.service_point_id AS "servicePointId", a.is_primary AS "isPrimary",
                p.name, p.zone, p.point_type AS type, p.status
           FROM team_member_service_points a
           JOIN merchant_service_points p ON p.id=a.service_point_id
          WHERE a.merchant_id=$1 ORDER BY p.point_type, p.name`, [merchantId]);
      for (const row of rows) {
        if (!map.has(row.memberId)) map.set(row.memberId, []);
        map.get(row.memberId).push(row);
      }
      return map;
    }
    for (const row of (team.base.state?.teamMemberServicePoints || [])) {
      if (row.merchantId !== merchantId) continue;
      if (!map.has(row.memberId)) map.set(row.memberId, []);
      map.get(row.memberId).push(row);
    }
    return map;
  }

  async function historyForPoint(merchantId, storeId, servicePointId, limit = 50) {
    if (!isPg()) {
      return (team.base.state?.teamAssignmentHistory || [])
        .filter((row) => row.merchantId === merchantId && row.storeId === storeId && row.servicePointId === servicePointId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
    }
    const { rows } = await pool().query(
      `SELECT id, service_point_id AS "servicePointId", member_id AS "memberId", member_label AS "memberLabel",
              action, from_member_id AS "fromMemberId", from_member_label AS "fromMemberLabel",
              actor_type AS "actorType", actor_label AS "actorLabel", created_at AS "createdAt"
         FROM team_assignment_history
        WHERE merchant_id=$1 AND store_id=$2 AND service_point_id=$3
        ORDER BY created_at DESC LIMIT $4`, [merchantId, storeId, servicePointId, Math.min(Number(limit) || 50, 200)]);
    return rows;
  }

  // ------------------------------------------------------------------ écriture
  // Remplace l'ensemble des affectations d'un membre. `points` = [{ servicePointId, primary }].
  // Toute affectation retirée est HISTORISÉE : on ne perd jamais « qui était responsable avant ».
  async function replaceForMember({ merchantId, storeId, memberId, points, actor }) {
    const member = await team.getMember(memberId, merchantId);
    if (!member) throw fail('Ce membre n’appartient pas à votre équipe.', 'MEMBER_NOT_OWNED', 403);
    if (member.status === 'archived') throw fail('Ce membre est archivé : affectation refusée.', 'MEMBER_ARCHIVED', 409);

    const requested = uniqueIds(points).slice(0, 200);
    const allowed = new Map((await pointsOfStore(storeId)).map((row) => [row.id, row]));
    const foreign = requested.filter((id) => !allowed.has(id));
    if (foreign.length) throw fail('Une table ou un salon choisi n’appartient pas à cet établissement.', 'POINT_NOT_OWNED', 403);

    const previous = await forMember(merchantId, memberId);
    const previousIds = new Set(previous.map((row) => row.servicePointId));
    const nextIds = new Set(requested);
    const added = requested.filter((id) => !previousIds.has(id));
    const removed = previous.filter((row) => !nextIds.has(row.servicePointId));
    const kept = previous.filter((row) => nextIds.has(row.servicePointId));
    const label = member.designation || member.fullName;
    const actorRow = { type: actor?.type || 'merchant', id: String(actor?.id || ''), label: actor?.label || 'Marchand' };

    // Affectation principale : la première table cochée, sinon la première conservée.
    const primaryId = requested[0] || kept[0]?.servicePointId || '';

    if (isPg()) {
      const client = await pool().connect();
      try {
        await client.query('BEGIN');
        if (removed.length) {
          await client.query('DELETE FROM team_member_service_points WHERE merchant_id=$1 AND member_id=$2 AND service_point_id = ANY($3::text[])',
            [merchantId, memberId, removed.map((row) => row.servicePointId)]);
        }
        for (const id of added) {
          await client.query(
            `INSERT INTO team_member_service_points (id, merchant_id, store_id, member_id, service_point_id, is_primary, assigned_by_type, assigned_by_id)
             VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7) ON CONFLICT (member_id, service_point_id) DO NOTHING`,
            [newId(), merchantId, storeId, memberId, id, actorRow.type, actorRow.id]);
        }
        // Une seule affectation principale par membre ET par table (index unique partiel).
        // Ordre impératif : on libère d'abord TOUTES les autres affectations principales portant sur
        // les tables visées, sinon l'insertion du nouveau principal violerait l'index unique.
        const touched = [...nextIds];
        if (touched.length) {
          await client.query(
            `UPDATE team_member_service_points SET is_primary=FALSE
              WHERE merchant_id=$1 AND member_id<>$2 AND service_point_id = ANY($3::text[]) AND is_primary`,
            [merchantId, memberId, touched]);
        }
        await client.query('UPDATE team_member_service_points SET is_primary=FALSE WHERE merchant_id=$1 AND member_id=$2 AND is_primary',
          [merchantId, memberId]);
        if (primaryId) {
          await client.query(
            `UPDATE team_member_service_points SET is_primary=TRUE, assigned_at=NOW()
              WHERE merchant_id=$1 AND member_id=$2 AND service_point_id=$3`,
            [merchantId, memberId, primaryId]);
        }
        // Historique : chaque AJOUT et chaque RETRAIT est une ligne datée. Pour un ajout, on note
        // aussi le responsable précédent de la table (s'il y en avait un) : la traçabilité reste
        // complète même quand une table change de main.
        // `team_service_point_assignments` ne stocke pas le libellé : on le lit dans team_members.
        const previousPrimaries = new Map((await client.query(
          `SELECT a.service_point_id AS "servicePointId", a.member_id AS "memberId",
                  COALESCE(NULLIF(m.designation, ''), m.full_name, '') AS "memberLabel"
             FROM team_service_point_assignments a
             LEFT JOIN team_members m ON m.id = a.member_id
            WHERE a.merchant_id=$1 AND a.service_point_id = ANY($2::text[]) AND a.member_id <> $3`,
          [merchantId, added.length ? added : [''], memberId])).rows.map((row) => [row.servicePointId, row]));
        const events = [
          ...added.map((id) => ({ servicePointId: id, action: 'assigned', from: previousPrimaries.get(id) || null })),
          ...removed.map((row) => ({ servicePointId: row.servicePointId, action: 'unassigned', from: null })),
        ];
        for (const event of events) {
          await client.query(
            `INSERT INTO team_assignment_history (id, merchant_id, store_id, service_point_id, member_id, member_label, action, from_member_id, from_member_label, actor_type, actor_label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [newId(), merchantId, storeId, event.servicePointId, memberId, label, event.action,
              event.from?.memberId || '', event.from?.memberLabel || '', actorRow.type, actorRow.label.slice(0, 120)]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    } else {
      const s = team.base.state;
      s.teamMemberServicePoints ||= [];
      s.teamAssignmentHistory ||= [];
      s.teamMemberServicePoints = s.teamMemberServicePoints.filter((row) => !(row.merchantId === merchantId && row.memberId === memberId && !nextIds.has(row.servicePointId)));
      for (const id of added) {
        s.teamMemberServicePoints.push({ id: newId(), merchantId, storeId, memberId, servicePointId: id, isPrimary: false,
          assignedByType: actorRow.type, assignedById: actorRow.id, assignedAt: new Date().toISOString() });
      }
      s.teamMemberServicePoints.forEach((row) => { if (row.merchantId === merchantId && row.memberId === memberId) row.isPrimary = row.servicePointId === primaryId; });
      s.teamMemberServicePoints.forEach((row) => { if (row.merchantId === merchantId && row.servicePointId === primaryId) row.isPrimary = row.memberId === memberId; });
      // Même journal en mode JSON : ajouts puis retraits, chacun daté.
      for (const id of added) {
        s.teamAssignmentHistory.push({ id: newId(), merchantId, storeId, servicePointId: id, memberId, memberLabel: label,
          action: 'assigned', fromMemberId: '', fromMemberLabel: '', actorType: actorRow.type, actorLabel: actorRow.label,
          createdAt: new Date().toISOString() });
      }
      for (const row of removed) {
        s.teamAssignmentHistory.push({ id: newId(), merchantId, storeId, servicePointId: row.servicePointId, memberId, memberLabel: label,
          action: 'unassigned', fromMemberId: memberId, fromMemberLabel: label, actorType: actorRow.type,
          actorLabel: actorRow.label, createdAt: new Date().toISOString() });
      }
      await team.base.save?.();
    }

    // La table principale garde l'affectation « qui reçoit la commande » (mécanisme mission 6).
    if (ops && typeof ops.assignServicePoint === 'function') {
      const currentPrimary = previous.find((row) => row.isPrimary)?.servicePointId || '';
      if (primaryId && primaryId !== currentPrimary) {
        await ops.assignServicePoint({ merchantId, storeId, servicePointId: primaryId, memberId,
          actor: { type: actorRow.type, id: actorRow.id, label: actorRow.label } }).catch(() => {});
      } else if (!primaryId && currentPrimary) {
        await ops.assignServicePoint({ merchantId, storeId, servicePointId: currentPrimary, memberId: '',
          actor: { type: actorRow.type, id: actorRow.id, label: actorRow.label } }).catch(() => {});
      }
    }

    const detail = added.length || removed.length
      ? `${added.length} ajout(s), ${removed.length} retrait(s)`
      : 'aucun changement';
    await team.recordActivity(merchantId, storeId, memberId, 'service_points_updated',
      `Affectations de ${label} mises à jour (${detail}).`, 'success',
      { added, removed: removed.map((row) => row.servicePointId), primaryId }).catch(() => {});

    return { memberId, primaryId, added, removed: removed.map((row) => row.servicePointId), assignments: await forMember(merchantId, memberId) };
  }

  return { forMember, mapByMember, replaceForMember, historyForPoint, pointsOfStore, uniqueIds };
};
