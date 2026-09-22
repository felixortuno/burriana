import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
export const warehouse = sqliteTable('warehouse', {id:integer('id').primaryKey(),revision:integer('revision').notNull(),data:text('data').notNull()});
