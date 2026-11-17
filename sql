sql {
  driver = "rlm_sql_postgresql"
  dialect = "postgresql"
  server = "db"
  port = 5432
  login = "freenet"
  password = "$ENV{DB_PASS}"
  radius_db = "freenet"
  read_clients = no
  authcheck_table = "radcheck"
  authreply_table = "radreply"
  pool { start = 2  min = 2  max = 10 }
}
