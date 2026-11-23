'use strict';

// ============================================================================================
// Opérations d'équipe : points, affectations de tables et de commandes, notifications internes.
//
// Règles vérifiées ici (jamais dans l'interface seule) :
//   - un point n'est attribué qu'une fois par événement source (`staff_point_events.source_key`
//     est unique par marchand + action) : un double scan ou un double clic ne crédite pas deux fois ;
//   - une commande annulée n'est jamais créditée comme commande terminée ;
//   - sans la règle explicite `credit_assigned_server`, une commande ne crédite QUE son auteur ;
//   - le journal des points est append-only : une correction est une nouvelle ligne, jamais un effacement ;
//   - une serveuse ne peut jamais écrire dans son propre journal de points.
// ============================================================================================

const crypto = require('node:crypto');

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);

const DEFAULT_POINTS = Object.freeze({
  pointsScan: 1, pointsOrder: 2, pointsOrderCompleted: 2, pointsTask: 2, creditAssignedServer: false,
});
const POINT_LABELS = Object.freeze({
  scan: 'Scan de table', order: 'Commande enregistrée', order_completed: 'Commande terminée', task: 'Tâche terminée',
  manual_add: 'Point ajouté manuellement', manual_remove: 'Point retiré', correction: 'Correction',
});

class TeamOps {
  constructor({ base, commerce, team }) {
    this.base = base;
    this.commerce = commerce;
    this.team = team;
    this.pg = Boolean(base && base.pool);
  }
  state() {
    const s = this.base.state;
    s.staffPointEvents ||= []; s.staffPointSettings ||= [];
    s.teamConversations ||= []; s.teamMessages ||= []; s.teamMessageReads ||= [];
    s.teamNotifications ||= []; s.teamServicePointAssignments ||= []; s.teamOrderAssignments ||= [];
    return s;
  }
  async save() { if (!this.pg) await this.base.save(); }

  // ------------------------------------------------------------------ barème
  async getPointSettings(merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT points_scan AS "pointsScan", points_order AS "pointsOrder", points_order_completed AS "pointsOrderCompleted",
                points_task AS "pointsTask", credit_assigned_server AS "creditAssignedServer"
           FROM staff_point_settings WHERE merchant_id=$1`, [merchantId]);
      return rows[0] || { ...DEFAULT_POINTS };
    }
    return { ...DEFAULT_POINTS, ...(this.state().staffPointSettings.find((s) => s.merchantId === merchantId) || {}) };
  }

  async updatePointSettings(merchantId, patch = {}) {
    const current = await this.getPointSettings(merchantId);
    const next = {
      pointsScan: clamp(patch.pointsScan, 0, 100, current.pointsScan),
      pointsOrder: clamp(patch.pointsOrder, 0, 100, current.pointsOrder),
      pointsOrderCompleted: clamp(patch.pointsOrderCompleted, 0, 100, current.pointsOrderCompleted),
      pointsTask: clamp(patch.pointsTask, 0, 100, current.pointsTask),
      creditAssignedServer: patch.creditAssignedServer === undefined ? current.creditAssignedServer === true : patch.creditAssignedServer === true,
    };
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO staff_point_settings (merchant_id, points_scan, points_order, points_order_completed, points_task, credit_assigned_server, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (merchant_id) DO UPDATE SET points_scan=EXCLUDED.points_scan, points_order=EXCLUDED.points_order,
           points_order_completed=EXCLUDED.points_order_completed, points_task=EXCLUDED.points_task,
           credit_assigned_server=EXCLUDED.credit_assigned_server, updated_at=NOW()`,
        [merchantId, next.pointsScan, next.pointsOrder, next.pointsOrderCompleted, next.pointsTask, next.creditAssignedServer]);
    } else {
      const s = this.state();
      const row = s.staffPointSettings.find((x) => x.merchantId === merchantId);
      if (row) Object.assign(row, next); else s.staffPointSettings.push({ merchantId, ...next });
      await this.save();
    }
    return this.getPointSettings(merchantId);
  }

  // ------------------------------------------------------------------ points
  // Attribue des points une seule fois par (marchand, source_key, action). Renvoie null si doublon.
  async awardPoints({ merchantId, storeId, memberId, memberLabel = '', action, points, reason = '', sourceKey, actor = {} }) {
    if (!merchantId || !memberId || !sourceKey) return null;
    const value = Math.round(Number(points) || 0);
    if (!value) return null;
    const row = {
      id: uid('spe'), merchantId, storeId, memberId, memberLabel: clean(memberLabel, 120), action, points: value,
      reason: clean(reason, 200), sourceKey: clean(sourceKey, 120), actorType: actor.type || 'system',
      actorId: clean(actor.id, 60), actorLabel: clean(actor.label, 120),
    };
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO staff_point_events (id, merchant_id, store_id, member_id, member_label, action, points, reason, source_key, actor_type, actor_id, actor_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (merchant_id, source_key, action) DO NOTHING RETURNING id`,
        [row.id, row.merchantId, row.storeId, row.memberId, row.memberLabel, row.action, row.points, row.reason, row.sourceKey, row.actorType, row.actorId, row.actorLabel]);
      if (!rows[0]) return null;
    } else {
      const s = this.state();
      if (s.staffPointEvents.some((e) => e.merchantId === merchantId && e.sourceKey === row.sourceKey && e.action === action)) return null;
      s.staffPointEvents.push({ ...row, createdAt: new Date().toISOString() }); await this.save();
    }
    await this.team.addPoints(memberId, value, row.reason || action).catch(() => {});
    return row;
  }

  // Correction manuelle : nouvelle ligne, jamais une réécriture. Le total reste la somme du journal.
  async manualAdjust({ merchantId, storeId, memberId, points, reason, actor }) {
    if (!reason || reason.length < 3) { const error = new Error('Indiquez le motif de la correction.'); error.status = 400; throw error; }
    const value = Math.round(Number(points) || 0);
    if (!value) { const error = new Error('Indiquez un nombre de points différent de zéro.'); error.status = 400; throw error; }
    const member = await this.team.getMember(memberId, merchantId);
    if (!member) { const error = new Error('Membre introuvable dans cette boutique.'); error.status = 404; throw error; }
    const action = value > 0 ? 'manual_add' : 'manual_remove';
    const sourceKey = `manual:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
    const row = await this.awardPoints({ merchantId, storeId, memberId, memberLabel: member.designation || member.fullName,
      action, points: value, reason, sourceKey, actor });
    await this.team.recordActivity(merchantId, storeId, memberId, action === 'manual_add' ? 'points_added' : 'points_removed',
      `${value > 0 ? '+' : ''}${value} point(s) : ${reason}.`, 'success', { actorLabel: actor?.label || '' }).catch(() => {});
    return row;
  }

  async pointsHistory(merchantId, { memberId = '', limit = 100, action = '' } = {}) {
    if (this.pg) {
      const params = [merchantId]; const where = ['merchant_id=$1'];
      if (memberId) { params.push(memberId); where.push(`member_id=$${params.length}`); }
      if (action) { params.push(action); where.push(`action=$${params.length}`); }
      params.push(Math.min(Number(limit) || 100, 500));
      const { rows } = await this.base.pool.query(
        `SELECT id, member_id AS "memberId", member_label AS "memberLabel", action, points, reason, source_key AS "sourceKey",
                actor_type AS "actorType", actor_label AS "actorLabel", created_at AS "createdAt"
           FROM staff_point_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params);
      return rows.map((row) => ({ ...row, actionLabel: POINT_LABELS[row.action] || row.action }));
    }
    const s = this.state();
    return s.staffPointEvents.filter((e) => e.merchantId === merchantId && (!memberId || e.memberId === memberId) && (!action || e.action === action))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Number(limit) || 100, 500))
      .map((e) => ({ ...e, actionLabel: POINT_LABELS[e.action] || e.action }));
  }

  // Statistiques individuelles : tout est calculé sur les événements réels, jamais sur des compteurs
  // entretenus à part. `period` : today | week | month | all.
  async memberStats(merchantId, memberId, { period = 'all' } = {}) {
    const since = periodStart(period);
    if (!this.pg) {
      return { memberId, period, points: 0, scans: 0, orders: 0, completedOrders: 0, validatedOrders: 0, tasksDone: 0, tasksLate: 0, byDay: [], byWeek: [], byMonth: [] };
    }
    const params = [merchantId, memberId]; let sinceClause = '';
    if (since) { params.push(since); sinceClause = ` AND created_at >= $${params.length}`; }
    // Les scans sont horodatés par `scanned_at`, pas par `created_at`.
    const sinceScan = since ? ` AND scanned_at >= $3` : '';
    const [points, scans, orders, completed, validated, tasks] = await Promise.all([
      this.base.pool.query(`SELECT COALESCE(SUM(points),0)::int AS total FROM staff_point_events WHERE merchant_id=$1 AND member_id=$2${sinceClause}`, params),
      this.base.pool.query(`SELECT COUNT(*)::int AS n FROM merchant_scan_events WHERE merchant_id=$1 AND member_id=$2${sinceScan}`, params),
      this.base.pool.query(`SELECT COUNT(*)::int AS n FROM merchant_orders WHERE merchant_id=$1 AND created_by_member_id=$2${sinceClause}`, params),
      this.base.pool.query(`SELECT COUNT(*)::int AS n FROM merchant_orders WHERE merchant_id=$1 AND created_by_member_id=$2 AND status='completed'${sinceClause}`, params),
      this.base.pool.query(`SELECT COUNT(*)::int AS n FROM merchant_orders WHERE merchant_id=$1 AND created_by_member_id=$2 AND status NOT IN ('cancelled','rejected')${sinceClause}`, params),
      this.base.pool.query(`SELECT
          COUNT(*) FILTER (WHERE status='done')::int AS done,
          COUNT(*) FILTER (WHERE status IN ('todo','in_progress') AND due_at IS NOT NULL AND due_at < NOW())::int AS late
        FROM team_tasks WHERE merchant_id=$1 AND member_id=$2`, [merchantId, memberId]),
    ]);
    const [byDay, byWeek, byMonth] = await Promise.all([
      this.base.pool.query(`SELECT TO_CHAR(DATE_TRUNC('day',created_at),'YYYY-MM-DD') AS period, COALESCE(SUM(points),0)::int AS points,
          COUNT(*) FILTER (WHERE action='scan')::int AS scans, COUNT(*) FILTER (WHERE action='order')::int AS orders
        FROM staff_point_events WHERE merchant_id=$1 AND member_id=$2 AND created_at >= NOW()-INTERVAL '14 days'
        GROUP BY 1 ORDER BY 1`, [merchantId, memberId]),
      this.base.pool.query(`SELECT TO_CHAR(DATE_TRUNC('week',created_at),'YYYY-MM-DD') AS period, COALESCE(SUM(points),0)::int AS points
        FROM staff_point_events WHERE merchant_id=$1 AND member_id=$2 AND created_at >= NOW()-INTERVAL '12 weeks'
        GROUP BY 1 ORDER BY 1`, [merchantId, memberId]),
      this.base.pool.query(`SELECT TO_CHAR(DATE_TRUNC('month',created_at),'YYYY-MM') AS period, COALESCE(SUM(points),0)::int AS points
        FROM staff_point_events WHERE merchant_id=$1 AND member_id=$2 AND created_at >= NOW()-INTERVAL '12 months'
        GROUP BY 1 ORDER BY 1`, [merchantId, memberId]),
    ]);
    return {
      memberId, period,
      points: Number(points.rows[0]?.total) || 0,
      scans: Number(scans.rows[0]?.n) || 0,
      orders: Number(orders.rows[0]?.n) || 0,
      completedOrders: Number(completed.rows[0]?.n) || 0,
      validatedOrders: Number(validated.rows[0]?.n) || 0,
      tasksDone: Number(tasks.rows[0]?.done) || 0,
      tasksLate: Number(tasks.rows[0]?.late) || 0,
      byDay: byDay.rows, byWeek: byWeek.rows, byMonth: byMonth.rows,
    };
  }

  // Classement : calculé à partir des mêmes événements. Aucune note de « qualité ».
  async leaderboard(merchantId, { period = 'week' } = {}) {
    if (!this.pg) return { period, rows: [] };
    const since = periodStart(period) || periodStart('month');
    const { rows } = await this.base.pool.query(
      `SELECT m.id, m.designation, m.full_name AS "fullName", m.role, m.status,
              COALESCE(p.points,0)::int AS points, COALESCE(s.scans,0)::int AS scans,
              COALESCE(o.orders,0)::int AS orders, COALESCE(o.completed,0)::int AS "completedOrders",
              COALESCE(t.done,0)::int AS "tasksDone"
         FROM team_members m
         LEFT JOIN (SELECT member_id, SUM(points) AS points FROM staff_point_events WHERE merchant_id=$1 AND created_at >= $2 GROUP BY member_id) p ON p.member_id=m.id
         LEFT JOIN (SELECT member_id, COUNT(*) AS scans FROM merchant_scan_events WHERE merchant_id=$1 AND scanned_at >= $2 AND member_id <> '' GROUP BY member_id) s ON s.member_id=m.id
         LEFT JOIN (SELECT created_by_member_id AS member_id, COUNT(*) AS orders,
                      COUNT(*) FILTER (WHERE status='completed') AS completed
                    FROM merchant_orders WHERE merchant_id=$1 AND created_at >= $2 AND created_by_member_id <> '' GROUP BY 1) o ON o.member_id=m.id
         LEFT JOIN (SELECT member_id, COUNT(*) AS done FROM team_tasks WHERE merchant_id=$1 AND status='done' AND updated_at >= $2 GROUP BY member_id) t ON t.member_id=m.id
        WHERE m.merchant_id=$1 AND m.status <> 'archived' AND m.role='waitress'
        ORDER BY points DESC, scans DESC, orders DESC, m.designation`, [merchantId, since]);
    return { period, since, rows: rows.map((row, index) => ({ ...row, rank: index + 1 })) };
  }

  // ------------------------------------------------------------------ notifications internes
  async notify({ merchantId, storeId, memberId, type, title, message, data = {}, dedupeKey }) {
    if (!merchantId || !memberId) return null;
    const key = clean(dedupeKey || `${type}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`, 120);
    const row = { id: uid('tn'), merchantId, storeId, memberId, type: clean(type, 40), title: clean(title, 160), message: clean(message, 500), data, dedupeKey: key };
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO team_notifications (id, merchant_id, store_id, member_id, notification_type, title, message, data, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (merchant_id, member_id, dedupe_key) DO NOTHING RETURNING id`,
        [row.id, row.merchantId, row.storeId, row.memberId, row.type, row.title, row.message, JSON.stringify(data || {}), key]);
      if (rows[0] && this.onNotify) { try { this.onNotify(row); } catch (_) {} }
      return rows[0] ? row : null;
    }
    const s = this.state();
    if (s.teamNotifications.some((n) => n.merchantId === merchantId && n.memberId === memberId && n.dedupeKey === key)) return null;
    s.teamNotifications.push({ ...row, readAt: null, createdAt: new Date().toISOString() }); await this.save();
    return row;
  }

  async listNotifications(memberId, { limit = 50, unreadOnly = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, notification_type AS type, title, message, data, read_at AS "readAt", created_at AS "createdAt"
           FROM team_notifications WHERE member_id=$1 ${unreadOnly ? 'AND read_at IS NULL' : ''}
          ORDER BY created_at DESC LIMIT $2`, [memberId, Math.min(Number(limit) || 50, 200)]);
      return rows;
    }
    return this.state().teamNotifications.filter((n) => n.memberId === memberId && (!unreadOnly || !n.readAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Number(limit) || 50, 200));
  }

  async unreadCount(memberId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT COUNT(*)::int AS n FROM team_notifications WHERE member_id=$1 AND read_at IS NULL', [memberId]);
      return Number(rows[0]?.n) || 0;
    }
    return this.state().teamNotifications.filter((n) => n.memberId === memberId && !n.readAt).length;
  }

  async markNotificationsRead(memberId, notificationId = '') {
    if (this.pg) {
      if (notificationId) await this.base.pool.query('UPDATE team_notifications SET read_at=NOW() WHERE member_id=$1 AND id=$2 AND read_at IS NULL', [memberId, notificationId]);
      else await this.base.pool.query('UPDATE team_notifications SET read_at=NOW() WHERE member_id=$1 AND read_at IS NULL', [memberId]);
      return this.unreadCount(memberId);
    }
    const s = this.state();
    s.teamNotifications.filter((n) => n.memberId === memberId && (!notificationId || n.id === notificationId) && !n.readAt).forEach((n) => { n.readAt = new Date().toISOString(); });
    await this.save();
    return this.unreadCount(memberId);
  }

  // ------------------------------------------------------------------ affectation des tables
  async assignServicePoint({ merchantId, storeId, servicePointId, memberId, actor }) {
    const point = await this.point(servicePointId, storeId);
    if (!point) { const error = new Error('Cette table n’appartient pas à votre boutique.'); error.status = 404; throw error; }
    if (memberId) {
      const member = await this.team.getMember(memberId, merchantId);
      if (!member) { const error = new Error('Ce membre n’appartient pas à votre équipe.'); error.status = 403; throw error; }
      if (member.status === 'archived' || member.status === 'blocked') { const error = new Error('Ce membre est bloqué ou archivé : affectation refusée.'); error.status = 409; throw error; }
    }
    if (this.pg) {
      if (!memberId) {
        await this.base.pool.query('DELETE FROM team_service_point_assignments WHERE service_point_id=$1 AND merchant_id=$2', [servicePointId, merchantId]);
      } else {
        await this.base.pool.query(
          `INSERT INTO team_service_point_assignments (id, merchant_id, store_id, service_point_id, member_id, assigned_by_type, assigned_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (service_point_id) DO UPDATE SET member_id=EXCLUDED.member_id, assigned_by_type=EXCLUDED.assigned_by_type,
             assigned_by_id=EXCLUDED.assigned_by_id, assigned_at=NOW()`,
          [uid('tspa'), merchantId, storeId, servicePointId, memberId, actor?.type || 'merchant', clean(actor?.id, 60)]);
      }
    } else {
      const s = this.state();
      s.teamServicePointAssignments = s.teamServicePointAssignments.filter((a) => a.servicePointId !== servicePointId);
      if (memberId) s.teamServicePointAssignments.push({ id: uid('tspa'), merchantId, storeId, servicePointId, memberId,
        assignedByType: actor?.type || 'merchant', assignedById: clean(actor?.id, 60), assignedAt: new Date().toISOString() });
      await this.save();
    }
    await this.team.recordActivity(merchantId, storeId, memberId || null, 'service_point_assigned',
      memberId ? `Table ${point.name} affectée.` : `Table ${point.name} libérée.`, 'success', { servicePointId }).catch(() => {});
    return { servicePointId, memberId: memberId || '' };
  }

  async point(servicePointId, storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, store_id AS "storeId", name, zone, point_type AS type, status, public_code AS "publicCode"
           FROM merchant_service_points WHERE id=$1 AND store_id=$2`, [servicePointId, storeId]);
      return rows[0] || null;
    }
    return this.state().merchantServicePoints?.find((p) => p.id === servicePointId && p.storeId === storeId) || null;
  }

  async listServicePointAssignments(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT a.service_point_id AS "servicePointId", a.member_id AS "memberId", m.designation, a.assigned_at AS "assignedAt"
           FROM team_service_point_assignments a LEFT JOIN team_members m ON m.id=a.member_id WHERE a.store_id=$1`, [storeId]);
      return rows;
    }
    return this.state().teamServicePointAssignments.filter((a) => a.storeId === storeId);
  }

  // Affectation automatique : la table scanne → la serveuse responsable de cette table.
  async autoAssignFromServicePoint(merchantId, storeId, servicePointId) {
    if (!this.pg || !servicePointId) return '';
    const { rows } = await this.base.pool.query(
      'SELECT member_id AS "memberId" FROM team_service_point_assignments WHERE service_point_id=$1 AND merchant_id=$2 AND store_id=$3',
      [servicePointId, merchantId, storeId]).catch(() => ({ rows: [] }));
    const memberId = rows[0]?.memberId || '';
    if (!memberId) return '';
    const member = await this.team.getMember(memberId, merchantId);
    return member && member.status === 'active' ? memberId : '';
  }

  // ------------------------------------------------------------------ affectation des commandes
  async assignOrder({ merchantId, storeId, orderId, memberId, reason = '', actor }) {
    const order = await this.commerce.getOrder(orderId).catch(() => null);
    if (!order || order.merchantId !== merchantId || order.storeId !== storeId) {
      const error = new Error('Commande introuvable dans votre boutique.'); error.status = 404; throw error;
    }
    let member = null;
    if (memberId) {
      member = await this.team.getMember(memberId, merchantId);
      if (!member) { const error = new Error('Ce membre n’appartient pas à votre équipe.'); error.status = 403; throw error; }
      if (['archived', 'blocked', 'suspended'].includes(member.status)) { const error = new Error('Ce membre n’est pas actif : affectation refusée.'); error.status = 409; throw error; }
    }
    const previous = await this.currentAssignment(orderId, merchantId);
    const action = !memberId ? 'unassigned' : previous?.memberId ? 'transferred' : 'assigned';
    const label = member ? (member.designation || member.fullName) : '';
    if (this.pg) {
      await this.base.pool.query('UPDATE merchant_orders SET assigned_member_id=$2, assigned_designation=$3 WHERE id=$1 AND merchant_id=$4',
        [orderId, memberId || '', label, merchantId]);
      await this.base.pool.query(
        `INSERT INTO team_order_assignments (id, merchant_id, store_id, order_id, member_id, member_label, action, from_member_id, from_member_label, reason, actor_type, actor_id, actor_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [uid('toa'), merchantId, storeId, orderId, memberId || null, label, action, previous?.memberId || null,
          previous?.memberLabel || '', clean(reason, 200), actor?.type || 'merchant', clean(actor?.id, 60), clean(actor?.label, 120)]);
    } else {
      const s = this.state();
      const row = (s.merchantOrders || []).find((o) => o.id === orderId && o.merchantId === merchantId);
      if (row) { row.assignedMemberId = memberId || ''; row.assignedDesignation = label; }
      s.teamOrderAssignments.push({ id: uid('toa'), merchantId, storeId, orderId, memberId: memberId || '', memberLabel: label,
        action, fromMemberId: previous?.memberId || '', fromMemberLabel: previous?.memberLabel || '', reason: clean(reason, 200),
        actorType: actor?.type || 'merchant', actorId: clean(actor?.id, 60), actorLabel: clean(actor?.label, 120), createdAt: new Date().toISOString() });
      await this.save();
    }
    if (memberId) {
      await this.notify({ merchantId, storeId, memberId, type: 'order_assigned',
        title: action === 'transferred' ? 'Commande transférée' : 'Nouvelle commande affectée',
        message: `Commande ${order.reference}${previous?.memberLabel ? ` — transférée de ${previous.memberLabel}` : ''}.`,
        data: { orderId, reference: order.reference }, dedupeKey: `order:${orderId}:assign:${Date.now()}` });
      await this.team.recordActivity(merchantId, storeId, memberId, 'order_assigned',
        `Commande ${order.reference} ${action === 'transferred' ? 'transférée à' : 'affectée à'} ${label}.`, 'success', { orderId }).catch(() => {});
    }
    return { orderId, memberId: memberId || '', action, previous };
  }

  async currentAssignment(orderId, merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT o.assigned_member_id AS "memberId", o.assigned_designation AS "memberLabel", o.created_by_member_id AS "authorId",
                o.created_by_designation AS "authorLabel"
           FROM merchant_orders o WHERE o.id=$1 AND o.merchant_id=$2`, [orderId, merchantId]);
      return rows[0] || null;
    }
    const row = (this.state().merchantOrders || []).find((o) => o.id === orderId && o.merchantId === merchantId);
    return row ? { memberId: row.assignedMemberId || '', memberLabel: row.assignedDesignation || '',
      authorId: row.createdByMemberId || '', authorLabel: row.createdByDesignation || '' } : null;
  }

  async assignmentHistory(orderId, merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT action, member_label AS "memberLabel", from_member_label AS "fromMemberLabel", reason,
                actor_type AS "actorType", actor_label AS "actorLabel", created_at AS "createdAt"
           FROM team_order_assignments WHERE order_id=$1 AND merchant_id=$2 ORDER BY created_at`, [orderId, merchantId]);
      return rows;
    }
    return this.state().teamOrderAssignments.filter((a) => a.orderId === orderId && a.merchantId === merchantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function periodStart(period) {
  if (period === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (period === 'week') { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (period === 'month') { const d = new Date(); d.setDate(d.getDate() - 29); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  return '';
}

module.exports = { TeamOps, DEFAULT_POINTS, POINT_LABELS, periodStart };
