/* Profile: password change. */
(function () {
  const { api, toast } = window.HD;

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/me/password', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
      f.reset(); toast('Password updated', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
})();
