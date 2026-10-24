const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export async function sendSupportReplyPush(db, messaging, uid) {
  const tokens = await db.collection('pushTokens').where('uid', '==', uid).limit(100).get();
  if (!tokens.docs.length) return 0;
  let sent = 0;
  await Promise.all(tokens.docs.map(async item => {
    try {
      await messaging.send({
        token: item.data().token,
        data: {
          title: 'New reply from 12toons',
          body: 'Open your support chat to read the reply.',
          url: '/#/',
          type: 'support-reply',
        },
        webpush: { headers: { TTL: '86400', Urgency: 'high' } },
      });
      sent++;
    } catch (error) {
      if (INVALID_TOKEN_CODES.has(error.code)) await item.ref.delete().catch(() => {});
      else console.warn('Support push delivery failed:', error.code || error.message);
    }
  }));
  return sent;
}
