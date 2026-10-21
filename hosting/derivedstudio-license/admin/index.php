<?php
declare(strict_types=1);
require_once __DIR__ . '/_auth.php';
dd_admin_require();

$pdo = dd_pdo();
$flash = '';
$createdKey = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    dd_csrf_check();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'logout') {
        dd_admin_logout();
        header('Location: login.php');
        exit;
    }
    if ($action === 'create') {
        $label = trim((string) ($_POST['customer_label'] ?? ''));
        $max = max(1, (int) ($_POST['max_machines'] ?? 2));
        $expires = trim((string) ($_POST['expires_at'] ?? ''));
        $notes = trim((string) ($_POST['notes'] ?? ''));
        $plain = dd_generate_key();
        $hash = dd_hash_key($plain);
        $prefix = substr($plain, 0, 10);
        $expVal = null;
        if ($expires !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $expires)) {
            $expVal = $expires . ' 23:59:59';
        }
        $stmt = $pdo->prepare(
            'INSERT INTO dd_licenses (key_hash, key_prefix, customer_label, status, max_machines, expires_at, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$hash, $prefix, $label, 'active', $max, $expVal, $notes]);
        $id = (int) $pdo->lastInsertId();
        dd_audit($id, 'created', 'label=' . $label);
        $createdKey = $plain;
        $flash = 'License created. Copy the key now — it will not be shown again.';
    } elseif ($action === 'revoke') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('UPDATE dd_licenses SET status = ? WHERE id = ?')->execute(['revoked', $id]);
        dd_audit($id, 'revoked');
        $flash = 'License revoked.';
    } elseif ($action === 'activate') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('UPDATE dd_licenses SET status = ? WHERE id = ?')->execute(['active', $id]);
        dd_audit($id, 'activated');
        $flash = 'License set active.';
    } elseif ($action === 'clear_machines') {
        $id = (int) ($_POST['id'] ?? 0);
        $pdo->prepare('DELETE FROM dd_license_machines WHERE license_id = ?')->execute([$id]);
        dd_audit($id, 'machines_cleared');
        $flash = 'Device bindings cleared.';
    } elseif ($action === 'remove_machine') {
        $id = (int) ($_POST['id'] ?? 0);
        $mid = (int) ($_POST['machine_row'] ?? 0);
        $pdo->prepare('DELETE FROM dd_license_machines WHERE id = ? AND license_id = ?')->execute([$mid, $id]);
        dd_audit($id, 'machine_removed', 'row=' . $mid);
        $flash = 'Device removed.';
    } elseif ($action === 'set_limit') {
        $id = (int) ($_POST['id'] ?? 0);
        $max = min(50, max(1, (int) ($_POST['max_machines'] ?? 2)));
        $pdo->prepare('UPDATE dd_licenses SET max_machines = ? WHERE id = ?')->execute([$max, $id]);
        dd_audit($id, 'limit_updated', 'max=' . $max);
        $flash = 'Machine limit updated.';
    } elseif ($action === 'set_expiry') {
        $id = (int) ($_POST['id'] ?? 0);
        $expires = trim((string) ($_POST['expires_at'] ?? ''));
        $expVal = ($expires !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $expires)) ? $expires . ' 23:59:59' : null;
        $pdo->prepare("UPDATE dd_licenses SET expires_at = ?, status = IF(status = 'expired', 'active', status) WHERE id = ?")
            ->execute([$expVal, $id]);
        dd_audit($id, 'expiry_updated', 'expires=' . ($expVal ?? 'never'));
        $flash = 'Expiry updated.';
    }
}

$csrf = dd_csrf_token();

$rows = $pdo->query(
    'SELECT l.*, (SELECT COUNT(*) FROM dd_license_machines m WHERE m.license_id = l.id) AS machine_count
     FROM dd_licenses l ORDER BY l.id DESC LIMIT 200'
)->fetchAll();

$machinesByLicense = [];
foreach ($pdo->query('SELECT id, license_id, machine_id, first_seen_at, last_seen_at FROM dd_license_machines ORDER BY last_seen_at DESC') as $m) {
    $machinesByLicense[(int) $m['license_id']][] = $m;
}

$audits = $pdo->query(
    'SELECT * FROM dd_license_audit ORDER BY id DESC LIMIT 40'
)->fetchAll();
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DashDialer license admin</title>
  <style>
    :root { --brand: #5a48e8; --ink: #1c1b24; --muted: #667; --line: #e4e7f2; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #f4f6fb; color: var(--ink); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: #fff; border-bottom: 1px solid var(--line); }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.2rem; margin: 0; }
    .grid { display: grid; gap: 18px; grid-template-columns: 1fr; }
    @media (min-width: 900px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(20,20,60,.06); }
    label { display: block; font-size: .78rem; color: var(--muted); margin: 10px 0 4px; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; }
    button, .btn { border: 0; border-radius: 10px; padding: 8px 12px; background: var(--brand); color: #fff; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; font-size: .85rem; }
    button.secondary { background: #eef0f8; color: var(--ink); }
    button.danger { background: #d9485f; }
    table { width: 100%; border-collapse: collapse; font-size: .85rem; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
    .flash { background: #e8fff4; border: 1px solid #b7efd0; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; }
    .keybox { font-family: ui-monospace, monospace; background: #111827; color: #fef3c7; padding: 12px; border-radius: 10px; margin-top: 8px; word-break: break-all; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .72rem; font-weight: 700; text-transform: uppercase; }
    .pill.active { background: #d1fae5; color: #065f46; }
    .pill.revoked { background: #fee2e2; color: #991b1b; }
    .pill.expired { background: #ffedd5; color: #9a3412; }
    .muted { color: var(--muted); font-size: .8rem; }
    form.inline { display: inline; }
  </style>
</head>
<body>
<header>
  <h1>DashDialer · License admin</h1>
  <div>
    <form class="inline" method="post">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
      <input type="hidden" name="action" value="logout" />
      <button class="secondary" type="submit">Sign out</button>
    </form>
  </div>
</header>
<main>
  <?php if ($flash): ?>
    <div class="flash">
      <?= htmlspecialchars($flash) ?>
      <?php if ($createdKey): ?>
        <div class="keybox" id="newkey"><?= htmlspecialchars($createdKey) ?></div>
        <p class="muted">Send this key to the customer. Store it in your password manager if needed.</p>
      <?php endif; ?>
    </div>
  <?php endif; ?>

  <div class="grid">
    <section class="card">
      <h2>Create license</h2>
      <p class="muted">After you receive payment, create a key and email it to the customer.</p>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
        <input type="hidden" name="action" value="create" />
        <label>Customer label</label>
        <input name="customer_label" placeholder="Acme Clinic" required />
        <label>Max machines</label>
        <input name="max_machines" type="number" min="1" value="2" />
        <label>Expires on (optional)</label>
        <input name="expires_at" type="date" />
        <label>Notes</label>
        <textarea name="notes" rows="2" placeholder="Paid via Zelle 2026-10-09"></textarea>
        <p style="margin-top:14px"><button type="submit">Create key</button></p>
      </form>
    </section>

    <section class="card">
      <h2>Recent audit</h2>
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
        <?php foreach ($audits as $a): ?>
          <tr>
            <td class="muted"><?= htmlspecialchars((string) $a['created_at']) ?></td>
            <td><?= htmlspecialchars((string) $a['action']) ?></td>
            <td class="muted">#<?= (int) ($a['license_id'] ?? 0) ?> <?= htmlspecialchars((string) ($a['detail'] ?? '')) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </section>
  </div>

  <section class="card" style="margin-top:18px">
    <h2>Licenses</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Customer</th><th>Prefix</th><th>Status</th><th>Machines</th><th>Expires</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): ?>
        <tr>
          <td><?= (int) $r['id'] ?></td>
          <td>
            <?= htmlspecialchars((string) $r['customer_label']) ?>
            <?php if ($r['notes']): ?><div class="muted"><?= htmlspecialchars((string) $r['notes']) ?></div><?php endif; ?>
          </td>
          <td><code><?= htmlspecialchars((string) $r['key_prefix']) ?>…</code></td>
          <td><span class="pill <?= htmlspecialchars((string) $r['status']) ?>"><?= htmlspecialchars((string) $r['status']) ?></span></td>
          <td>
            <?= (int) $r['machine_count'] ?> / <?= (int) $r['max_machines'] ?>
            <?php foreach ($machinesByLicense[(int) $r['id']] ?? [] as $m): ?>
              <div class="muted">
                <code><?= htmlspecialchars(substr((string) $m['machine_id'], 0, 8)) ?>…</code>
                last seen <?= htmlspecialchars((string) $m['last_seen_at']) ?>
                <form class="inline" method="post" onsubmit="return confirm('Remove this device?');">
                  <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
                  <input type="hidden" name="action" value="remove_machine" />
                  <input type="hidden" name="id" value="<?= (int) $r['id'] ?>" />
                  <input type="hidden" name="machine_row" value="<?= (int) $m['id'] ?>" />
                  <button class="secondary" type="submit" style="padding:2px 8px">✕</button>
                </form>
              </div>
            <?php endforeach; ?>
          </td>
          <td class="muted">
            <?= htmlspecialchars((string) ($r['expires_at'] ?? '—')) ?>
            <form class="inline" method="post">
              <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
              <input type="hidden" name="action" value="set_expiry" />
              <input type="hidden" name="id" value="<?= (int) $r['id'] ?>" />
              <input name="expires_at" type="date" style="width:140px" />
              <button class="secondary" type="submit" style="padding:4px 8px">Set</button>
            </form>
          </td>
          <td>
            <?php if ($r['status'] !== 'revoked'): ?>
              <form class="inline" method="post" onsubmit="return confirm('Revoke this license? The customer app will lock on its next check.');">
                <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
                <input type="hidden" name="action" value="revoke" />
                <input type="hidden" name="id" value="<?= (int) $r['id'] ?>" />
                <button class="danger" type="submit">Revoke</button>
              </form>
            <?php else: ?>
              <form class="inline" method="post">
                <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
                <input type="hidden" name="action" value="activate" />
                <input type="hidden" name="id" value="<?= (int) $r['id'] ?>" />
                <button class="secondary" type="submit">Re-activate</button>
              </form>
            <?php endif; ?>
            <form class="inline" method="post" onsubmit="return confirm('Clear all devices for this license?');">
              <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
              <input type="hidden" name="action" value="clear_machines" />
              <input type="hidden" name="id" value="<?= (int) $r['id'] ?>" />
              <button class="secondary" type="submit">Clear devices</button>
            </form>
            <form class="inline" method="post">
              <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>" />
              <input type="hidden" name="action" value="set_limit" />
              <input type="hidden" name="id" value="<?= (int) $r['id'] ?>" />
              <input name="max_machines" type="number" min="1" max="50" value="<?= (int) $r['max_machines'] ?>" style="width:64px" />
              <button class="secondary" type="submit">Set limit</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </section>
</main>
</body>
</html>
