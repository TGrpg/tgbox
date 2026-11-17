-- The USDT watcher records each transfer that matched no order once, and checks this index for
-- the ones it already recorded on every tick that has an order waiting. Partial: other audit rows
-- don't pay for it.
CREATE INDEX audit_usdt_unmatched ON audit_log (target) WHERE action = 'usdt.unmatched';
