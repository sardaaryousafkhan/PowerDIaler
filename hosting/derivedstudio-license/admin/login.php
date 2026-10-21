<?php
declare(strict_types=1);
require_once __DIR__ . '/_auth.php';

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    dd_csrf_check();
    $user = trim((string) ($_POST['user'] ?? ''));
    $pass = (string) ($_POST['pass'] ?? '');
    if (dd_admin_attempt_login($user, $pass)) {
        header('Location: index.php');
        exit;
    }
    $error = 'Invalid username or password.';
}
if (!empty($_SESSION['dd_admin'])) {
    header('Location: index.php');
    exit;
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DashDialer license admin</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f6fb; margin: 0; padding: 40px 16px; }
    .card { max-width: 380px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 10px 30px rgba(20,20,60,.08); }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    p { color: #667; font-size: .9rem; }
    label { display: block; font-size: .8rem; color: #556; margin: 14px 0 6px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #d8dce8; border-radius: 10px; box-sizing: border-box; }
    button { margin-top: 18px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: #5a48e8; color: #fff; font-weight: 600; cursor: pointer; }
    .err { color: #b00020; font-size: .9rem; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>DashDialer licenses</h1>
    <p>Sign in to issue or revoke customer keys.</p>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars(dd_csrf_token()) ?>" />
      <label>Username</label>
      <input name="user" autocomplete="username" required />
      <label>Password</label>
      <input name="pass" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
    <?php if ($error): ?><p class="err"><?= htmlspecialchars($error) ?></p><?php endif; ?>
  </div>
</body>
</html>
