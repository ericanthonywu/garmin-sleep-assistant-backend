import knex from 'knex';
import knexConfig from '../../knexfile.js';
import { env } from '../config/env.js';

const environment = env.NODE_ENV || 'development';
const config = knexConfig[environment] || knexConfig.development;

export const db = knex(config);
export default db;
