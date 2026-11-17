-- Every duplicate is ambiguous: keep the original quote for manual reconciliation, but never
-- let the watcher choose a buyer arbitrarily. Unambiguous pending and all historical rows stay.
INSERT INTO audit_log (actor, action, target, payload, created_at)
SELECT 'system', 'usdt.amount_conflict', 'order:' || order_id,
       json_object('amountMicro', amount_micro, 'address', address,
                   'createdAt', created_at, 'expiresAt', expires_at),
       unixepoch() * 1000
FROM usdt_payments
WHERE status = 'pending' AND amount_micro IN (
  SELECT amount_micro FROM usdt_payments WHERE status = 'pending'
  GROUP BY amount_micro HAVING count(*) > 1
);
--> statement-breakpoint
UPDATE usdt_payments SET status = 'expired'
WHERE status = 'pending' AND amount_micro IN (
  SELECT amount_micro FROM usdt_payments WHERE status = 'pending'
  GROUP BY amount_micro HAVING count(*) > 1
);
--> statement-breakpoint
DROP INDEX IF EXISTS usdt_pending_amount;
--> statement-breakpoint
CREATE UNIQUE INDEX usdt_pending_amount ON usdt_payments (amount_micro) WHERE status = 'pending';
