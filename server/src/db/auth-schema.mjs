export async function ensureAuthProfileSchema(db, driver) {
  const timestampType = driver === "postgres" ? "varchar(32)" : "text";
  await db.schema
    .createTable("auth_user_profiles")
    .ifNotExists()
    .addColumn("user_id", "varchar(96)", (column) => column.primaryKey().references("user.id").onDelete("cascade"))
    .addColumn("last_login_at", timestampType)
    .execute();

}
