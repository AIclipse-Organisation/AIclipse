// Load user details and setup logout handler
window.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('user-details-status');
  const containerEl = document.getElementById('user-details-container');

  try {
    statusEl.textContent = 'Loading user details...';
    statusEl.className = 'status-message loading';

    const response = await fetch('/auth/me', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user details');
    }

    const user = await response.json();

    // Update UI with user details
    document.getElementById('detail-username').textContent = user.user_name || '-';
    document.getElementById('detail-email').textContent = user.email || '-';
    document.getElementById('detail-plan').textContent = (user.plan !== undefined && user.plan !== null) ? user.plan : 0;
    document.getElementById('detail-created').textContent = user.created_at 
      ? new Date(user.created_at).toLocaleDateString() 
      : '-';
    document.getElementById('detail-total-guesses').textContent = user.total_guesses !== undefined ? user.total_guesses : 0;
    document.getElementById('detail-total-correct').textContent = user.total_correct !== undefined ? user.total_correct : 0;
    document.getElementById('detail-acc-ai').textContent = (user.acc_guessing_ai !== undefined && user.acc_guessing_ai !== null)
      ? (user.acc_guessing_ai * 100).toFixed(1) + '%'
      : '0.0%';
    document.getElementById('detail-acc-real').textContent = (user.acc_guessing_real !== undefined && user.acc_guessing_real !== null)
      ? (user.acc_guessing_real * 100).toFixed(1) + '%'
      : '0.0%';
    document.getElementById('detail-monthly-usage').textContent = user.monthly_usage_count !== undefined ? user.monthly_usage_count : 0;

    // Show container and hide status
    statusEl.textContent = '';
    statusEl.className = 'status-message';
    containerEl.style.display = 'block';

  } catch (error) {
    console.error('Error loading user details:', error);
    statusEl.textContent = 'Failed to load user details. Please log in.';
    statusEl.className = 'status-message error';
  }
  
  // Logout button handler
  const btnLogout = document.getElementById('btn-logout');
  btnLogout.addEventListener('click', async () => {
    try {
      const response = await fetch('/logout', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });

      if (response.ok) {
        window.location.href = '/';
      } else {
        alert('Logout failed. Please try again.');
      }
    } catch (error) {
      console.error('Error during logout:', error);
      alert('Network error during logout.');
    }
  });
});
