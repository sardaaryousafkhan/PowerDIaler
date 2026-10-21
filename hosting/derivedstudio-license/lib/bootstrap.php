<?php
declare(strict_types=1);

function dd_env_path(): string
{
    $candidates = [
        dirname(__DIR__) . '/.env',
        dirname(__DIR__, 2) . '/.env',
    ];
    foreach ($candidates as $p) {
        if (is_file($p)) {
            return $p;
        }
    }
    return dirname(__DIR__) . '/.env';
}

function dd_load_env(): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $loaded = true;
    $path = dd_env_path();
    if (!is_file($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        $v = trim($v, "\"'");
        if ($k !== '' && getenv($k) === false) {
            putenv("$k=$v");
            $_ENV[$k] = $v;
        }
    }
}

function dd_env(string $key, ?string $default = null): ?string
{
    dd_load_env();
    $v = $_ENV[$key] ?? getenv($key);
    if ($v === false || $v === null || $v === '') {
        return $default;
    }
    return (string) $v;
}

function dd_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $host = dd_env('DD_DB_HOST', 'localhost');
    $name = dd_env('DD_DB_NAME');
    $user = dd_env('DD_DB_USER');
    $pass = dd_env('DD_DB_PASS', '');
    if (!$name || !$user) {
        throw new RuntimeException('Database env not configured (DD_DB_NAME / DD_DB_USER).');
    }
    $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function dd_hash_key(string $plaintext): string
{
    $pepper = (string) dd_env('DD_KEY_PEPPER', '');
    // Fail closed: a missing/short pepper would make every stored hash guessable.
    if (strlen($pepper) < 16 || $pepper === 'insecure-default-pepper' || str_starts_with($pepper, 'change-me')) {
        throw new RuntimeException('DD_KEY_PEPPER is missing or too weak (need 16+ random characters in .env).');
    }
    return hash('sha256', $pepper . '|' . $plaintext);
}

/** Normalise a customer-typed key: trims, uppercases, tolerates missing dashes/spaces. */
function dd_normalize_key(string $raw): string
{
    $k = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $raw) ?? '');
    if (strlen($k) === 18 && str_starts_with($k, 'DD')) {
        $body = substr($k, 2);
        return 'DD-' . implode('-', str_split($body, 4));
    }
    return strtoupper(trim($raw));
}

/** CSRF token for admin forms (per session). */
function dd_csrf_token(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    if (empty($_SESSION['dd_csrf'])) {
        $_SESSION['dd_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['dd_csrf'];
}

function dd_csrf_check(): void
{
    $sent = (string) ($_POST['csrf'] ?? '');
    if ($sent === '' || !hash_equals(dd_csrf_token(), $sent)) {
        http_response_code(403);
        echo 'Invalid or expired form token. Go back and try again.';
        exit;
    }
}

function dd_generate_key(): string
{
    $raw = strtoupper(bin2hex(random_bytes(12)));
    return 'DD-' . substr($raw, 0, 4) . '-' . substr($raw, 4, 4) . '-' . substr($raw, 8, 4) . '-' . substr($raw, 12, 4);
}

function dd_audit(?int $licenseId, string $action, string $detail = '', string $actor = 'admin'): void
{
    $pdo = dd_pdo();
    $stmt = $pdo->prepare(
        'INSERT INTO dd_license_audit (license_id, action, detail, actor, ip) VALUES (?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $licenseId,
        $action,
        $detail,
        $actor,
        $_SERVER['REMOTE_ADDR'] ?? null,
    ]);
}

function dd_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function dd_client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Simple file-based rate limit: max $max hits per $windowSec per IP. */
function dd_rate_limit(string $bucket, int $max = 30, int $windowSec = 60): bool
{
    $dir = sys_get_temp_dir() . '/dd_license_rl';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $ip = preg_replace('/[^a-fA-F0-9\.:]/', '', dd_client_ip()) ?: 'unknown';
    $file = $dir . '/' . $bucket . '_' . md5($ip) . '.json';
    $now = time();
    $data = ['start' => $now, 'count' => 0];
    if (is_file($file)) {
        $raw = json_decode((string) file_get_contents($file), true);
        if (is_array($raw) && isset($raw['start'], $raw['count'])) {
            $data = $raw;
        }
    }
    if ($now - (int) $data['start'] > $windowSec) {
        $data = ['start' => $now, 'count' => 0];
    }
    $data['count'] = (int) $data['count'] + 1;
    file_put_contents($file, json_encode($data), LOCK_EX);
    return $data['count'] <= $max;
}
