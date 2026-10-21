<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

// Called only by the desktop app (server-to-server style); no browser CORS needed.
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    dd_json(['ok' => false, 'error' => 'POST required'], 405);
}

if (!dd_rate_limit('verify', 60, 60)) {
    dd_json(['ok' => false, 'error' => 'Too many requests'], 429);
}

$raw = file_get_contents('php://input') ?: '';
if (strlen($raw) > 4096) {
    dd_json(['ok' => false, 'status' => 'inactive', 'error' => 'Request too large'], 413);
}
$body = json_decode($raw, true);
if (!is_array($body)) {
    $body = $_POST;
}

$key = dd_normalize_key((string) ($body['key'] ?? ''));
$machineId = trim((string) ($body['machineId'] ?? ''));

if ($key === '' || strlen($key) < 8 || strlen($key) > 64) {
    dd_json(['ok' => false, 'status' => 'inactive', 'error' => 'Invalid license key'], 400);
}
if ($machineId === '' || strlen($machineId) > 64 || !preg_match('/^[A-Za-z0-9_-]+$/', $machineId)) {
    dd_json(['ok' => false, 'status' => 'inactive', 'error' => 'Invalid machine id'], 400);
}

try {
    $pdo = dd_pdo();
    $hash = dd_hash_key($key);
} catch (Throwable $e) {
    error_log('[dd-license] ' . $e->getMessage());
    dd_json(['ok' => false, 'status' => 'error', 'error' => 'License service unavailable'], 503);
}
$stmt = $pdo->prepare('SELECT * FROM dd_licenses WHERE key_hash = ? LIMIT 1');
$stmt->execute([$hash]);
$lic = $stmt->fetch();

if (!$lic) {
    // Unknown keys are logged so brute-force attempts are visible in the admin audit.
    if (!dd_rate_limit('verify_unknown_audit', 5, 300)) {
        dd_json(['ok' => false, 'status' => 'inactive', 'error' => 'Unknown license key'], 404);
    }
    dd_audit(null, 'verify_unknown_key', 'prefix=' . substr($key, 0, 7) . ' machine=' . substr($machineId, 0, 8), 'app');
    dd_json(['ok' => false, 'status' => 'inactive', 'error' => 'Unknown license key'], 404);
}

$status = (string) $lic['status'];
if ($status === 'revoked') {
    dd_json(['ok' => false, 'status' => 'revoked', 'error' => 'License revoked'], 403);
}
if ($status === 'expired') {
    dd_json(['ok' => false, 'status' => 'expired', 'expiresAt' => $lic['expires_at'], 'error' => 'License expired'], 403);
}

$expiresAt = $lic['expires_at'];
if ($expiresAt !== null && $expiresAt !== '') {
    if (strtotime((string) $expiresAt) < time()) {
        if ($status !== 'expired') {
            $pdo->prepare('UPDATE dd_licenses SET status = ? WHERE id = ?')->execute(['expired', $lic['id']]);
        }
        dd_json(['ok' => false, 'status' => 'expired', 'expiresAt' => $expiresAt, 'error' => 'License expired'], 403);
    }
}

$max = (int) $lic['max_machines'];
$licId = (int) $lic['id'];

$find = $pdo->prepare('SELECT id FROM dd_license_machines WHERE license_id = ? AND machine_id = ? LIMIT 1');
$find->execute([$licId, $machineId]);
$existing = $find->fetch();

if (!$existing) {
    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM dd_license_machines WHERE license_id = ?');
    $countStmt->execute([$licId]);
    $count = (int) $countStmt->fetchColumn();
    if ($count >= $max) {
        dd_json([
            'ok' => false,
            'status' => 'machine_limit',
            'error' => 'Machine limit reached. Contact the seller to free a seat.',
            'machines' => $count,
            'maxMachines' => $max,
        ], 403);
    }
    $ins = $pdo->prepare('INSERT INTO dd_license_machines (license_id, machine_id) VALUES (?, ?)');
    $ins->execute([$licId, $machineId]);
    // Audit only new device activations; routine 4-hourly heartbeats just bump last_seen_at.
    dd_audit($licId, 'machine_activated', 'machine=' . substr($machineId, 0, 8), 'app');
} else {
    $pdo->prepare('UPDATE dd_license_machines SET last_seen_at = NOW() WHERE id = ?')->execute([$existing['id']]);
}

$countStmt = $pdo->prepare('SELECT COUNT(*) FROM dd_license_machines WHERE license_id = ?');
$countStmt->execute([$licId]);
$machines = (int) $countStmt->fetchColumn();

dd_json([
    'ok' => true,
    'status' => 'active',
    'expiresAt' => $expiresAt,
    'machines' => $machines,
    'maxMachines' => $max,
    'graceHintDays' => 7,
]);
