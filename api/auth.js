const admin = require('firebase-admin');
const axios = require('axios');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG))
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send('<h1>Erreur</h1><p>Code Discord manquant.</p>');
  }

  try {
    // 1. Échange du code contre le token
    const tokenRes = await axios.post(
      'https://discord.com/api/v10/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // 2. Récupération du profil Discord
    const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    const discordId = userRes.data.id;
    const discordTag = userRes.data.username;

    // 3. Récupération de l'IP du visiteur
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && clientIp.includes(',')) {
      clientIp = clientIp.split(',')[0].trim();
    }

    // 4. Verification dans Firebase
    const verifRef = db.collection('verifications');
    const snapshot = await verifRef.where('ip', '==', clientIp).get();

    if (!snapshot.empty) {
      const existingDoc = snapshot.docs[0].data();
      if (existingDoc.discordId !== discordId) {
        return res.send(`<h1 style="color:red;text-align:center;">🚨 DOUBLE COMPTE DÉTECTÉ (${existingDoc.discordTag})</h1>`);
      }
    } else {
      await verifRef.add({
        discordId,
        discordTag,
        ip: clientIp,
        createdAt: new Date().toISOString()
      });
    }

    return res.send(`<h1 style="color:green;text-align:center;">✅ VÉRICATION RÉUSSIE (${discordTag})</h1>`);

  } catch (error) {
    return res.status(500).send('Erreur serveur : ' + error.message);
  }
};
