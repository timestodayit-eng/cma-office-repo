#!/bin/sh
# Daily database backup into /backups, keeps the last 14 days.
while true; do
  pg_dump -h db -U cma cma | gzip > "/backups/cma-$(date +%F).sql.gz"
  find /backups -name 'cma-*.sql.gz' -mtime +14 -delete
  sleep 86400
done
