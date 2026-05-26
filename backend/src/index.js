import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import transactionsRouter from './routes/transactions.js';
import categoriesRouter from './routes/categories.js';
import rulesRouter from './routes/rules.js';
import vouchersRouter from './routes/vouchers.js';
import dashboardRouter from './routes/dashboard.js';
import uploadRouter from './routes/upload.js';
import settingsRouter from './routes/settings.js';
import { startScheduler } from './services/syncScheduler.js';

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

app.use('/api', requireAuth);

app.use('/api/auth', authRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/settings', settingsRouter);

startScheduler();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
