<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';

$ddHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $ddHttps,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_name('ddadmin');
session_start();

// Idle timeout: 2 hours.
if (!empty($_SESSION['dd_admin']) && isset($_SESSION['dd_last']) && time() - (int) $_SESSION['dd_last'] > 7200) {
    $_SESSION = [];
    session_destroy();
    session_start();
}
$_SESSION['dd_last'] = time();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

function dd_admin_require(): void
{
    $allow = trim((string) dd_env('DD_ADMIN_IP_ALLOWLIST', ''));
    if ($allow !== '') {
        $ips = array_map('trim', explode(',', $allow));
        if (!in_array(dd_client_ip(), $ips, true)) {
            http_response_code(403);
            echo 'Forbidden IP';
            exit;
        }
    }
    if (empty($_SESSION['dd_admin'])) {
        header('Location: login.php');
        exit;
    }
}

function dd_admin_attempt_login(string $user, string $pass): bool
{
    // 10 attempts per 15 minutes per IP.
    if (!dd_rate_limit('admin_login', 10, 900)) {
        usleep(500000);
        return false;
    }
    $expectUser = (string) dd_env('DD_ADMIN_USER', 'owner');
    $expectPass = (string) dd_env('DD_ADMIN_PASS', '');
    $expectHash = (string) dd_env('DD_ADMIN_PASS_HASH', '');

    $passOk = false;
    if ($expectHash !== '') {
        $passOk = password_verify($pass, $expectHash);
    } elseif ($expectPass !== '' && strlen($expectPass) >= 12) {
        $passOk = hash_equals($expectPass, $pass);
    }
    if (!$passOk || !hash_equals($expectUser, $user)) {
        try {
            dd_audit(null, 'admin_login_failed', 'user=' . substr($user, 0, 40), 'admin');
        } catch (Throwable $e) {
            // DB may be down; still deny.
        }
        usleep(300000);
        return false;
    }
    session_regenerate_id(true);
    $_SESSION['dd_admin'] = $user;
    $_SESSION['dd_csrf'] = bin2hex(random_bytes(32));
    try {
        dd_audit(null, 'admin_login', 'user=' . $user, 'admin');
    } catch (Throwable $e) {
        // non-fatal
    }
    return true;
}

function dd_admin_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}
