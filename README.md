# QRia — générateur de codes QR

Application web autonome en français pour créer des QR codes à partir d’un lien, d’un message ou d’identifiants Wi-Fi. Personnalisation des couleurs et de la correction d’erreur, export PNG/SVG et génération entièrement locale dans le navigateur.

## Lancer l’application

Aucune installation ni compilation n’est nécessaire. Depuis ce dossier, lancez un serveur statique :

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Puis ouvrez `http://localhost:8000`.

La bibliothèque embarquée `qrcode-generator` et son avis de licence MIT se trouvent dans `vendor/`.
