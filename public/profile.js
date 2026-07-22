/* Profile: notification email + password change. */
(function () {
  const { api, toast } = window.HD;

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('PATCH', '/api/me', { email: f.email.value.trim(), notifyEnabled: f.notifyEnabled.checked });
      toast('Saved', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/me/password', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
      f.reset(); toast('Password updated', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
})();
