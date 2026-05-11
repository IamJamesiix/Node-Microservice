import axios from 'axios';
import config from '../config/dotenv.js';

const squadClient = axios.create({
  baseURL: config.SQUAD_BASE_URL,
  headers: {
    Authorization: `Bearer ${config.SQUAD_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Create a virtual account for a new user via Squad
 */
export async function createVirtualAccount({ phone, firstName, lastName, email, bvn }) {
  const response = await squadClient.post('/virtual-account', {
    phone_number: phone,
    first_name: firstName,
    last_name: lastName,
    email: email || `${phone.replace('+', '')}@kollique.ng`, // fallback email
    bvn: bvn || undefined,
    customer_identifier: phone, // unique per user
  });

  return response.data; // { status, data: { virtual_account_number, bank_name, ... } }
}

/**
 * Get virtual account balance
 */
export async function getVirtualAccountBalance(accountNumber) {
  const response = await squadClient.get(`/virtual-account/balance/${accountNumber}`);
  return response.data;
}

/**
 * Verify a Squad payment transaction
 */
export async function verifyTransaction(transactionRef) {
  const response = await squadClient.get(`/transaction/verify/${transactionRef}`);
  return response.data;
}