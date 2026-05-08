import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 8040;

app.listen(PORT, () => {
  console.log(`🚀 Kolliq server running on port ${PORT}`);
});