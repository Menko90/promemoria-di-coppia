#!/bin/bash
# Esegue i test del database su un Postgres locale (porta 54329)
set -e
PSQL="psql -h /tmp/pgtest -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists promemoria_test" >/dev/null
$PSQL -d postgres -c "create database promemoria_test" >/dev/null
$PSQL -d promemoria_test -f tests/supabase_mock.sql >/dev/null
$PSQL -d promemoria_test -f supabase/migrations/0001_schema.sql >/dev/null
$PSQL -d promemoria_test -f tests/db_test.sql
