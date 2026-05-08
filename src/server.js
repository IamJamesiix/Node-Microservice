import config from './config/dotenv.js';
import app from './app.js';

const PORT = config.PORT || 8040;

app.listen(PORT, () => {
  console.log(`🚀 Kolliq server running on port ${PORT}`);
});