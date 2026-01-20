// Fetch and display all user scans
async function loadScans() {
  const statusEl = document.getElementById('scans-status');
  const containerEl = document.getElementById('scans-container');
  
  statusEl.innerHTML = '<div class="loading">Loading your scans...</div>';
  containerEl.innerHTML = '';
  
  try {
    // Fetch all images without any filter (no is_public parameter)
    const response = await fetch('/images', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      credentials: 'include'
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        statusEl.innerHTML = '<div class="error">Please log in to view your scans.</div>';
        return;
      }
      throw new Error(`Failed to load scans (${response.status})`);
    }
    
    const data = await response.json();
    const items = data.items || [];
    
    statusEl.innerHTML = '';
    
    if (items.length === 0) {
      containerEl.innerHTML = '<div class="status-message">No scans found. Upload and analyze some images first!</div>';
      return;
    }
    
    // Render all images
    items.forEach(img => {
      const card = document.createElement('div');
      card.className = 'scan-card';
      
      const verdictClass = img.verdict === 'safe' ? 'verdict-safe' : 
                          img.verdict === 'deepfake' ? 'verdict-deepfake' : '';
      
      // Create image element or placeholder
      let imageHTML = '';
      if (img.url) {
        imageHTML = `<img src="${img.url}" alt="Scan ${img.image_id}" class="scan-image" onclick="window.open('${img.url}', '_blank')">`;
      } else {
        imageHTML = '<div class="image-placeholder">No image available</div>';
      }
      
      card.innerHTML = `
        ${imageHTML}
        <div class="scan-content">
          <div>
            <strong>ID:</strong> ${img.image_id || 'N/A'}
          </div>
          <div class="meta">
            <strong>Verdict:</strong> <span class="${verdictClass}">${img.verdict || 'N/A'}</span>
          </div>
          <div class="meta">
            <strong>Label:</strong> ${img.label || 'N/A'}
          </div>
          <div class="meta">
            <strong>Confidence:</strong> ${img.confidence != null ? img.confidence.toFixed(3) : 'N/A'}
          </div>
          <div class="flags">
            Visibility: ${img.is_public ? 'Public' : 'Private'} • 
            Uploaded: ${img.uploaded_at ? new Date(img.uploaded_at).toLocaleDateString() : 'N/A'}
          </div>
        </div>
      `;
      
      containerEl.appendChild(card);
    });
    
  } catch (error) {
    console.error('Error loading scans:', error);
    statusEl.innerHTML = `<div class="error">Error: ${error.message}</div>`;
  }
}

// Load scans when page loads
window.addEventListener('DOMContentLoaded', loadScans);
