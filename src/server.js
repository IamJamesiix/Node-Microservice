import config from './config/dotenv.js';
import './services/retryQueue.js';
import app from './app.js';

const PORT = config.PORT || 8040;

// Boot Redis pub/sub subscriber (runs in background alongside Express)
import('./services/notificationSubscriber.js')
  .then(() => console.log('📡 Notification subscriber started'))
  .catch((err) => console.error('❌ Subscriber failed:', err.message));

  // Boot retry queue processor (retries failed Django calls every 30s)
import('./services/retryQueue.js')
  .then(() => console.log('🔁 Retry queue processor started'))
  .catch((err) => console.error('❌ Retry queue failed:', err.message));
 
app.listen(PORT, () => {
  console.log(`🚀 Kolliq Node server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Auth:   POST /auth/request-otp | /auth/verify-otp`);
  console.log(`   USSD:   POST /ussd`);
  console.log(`   WA:     POST /whatsapp`);
  console.log(`   Hook:   POST /webhooks/squad`);
});