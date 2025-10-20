document.addEventListener("DOMContentLoaded", () => {
  fetch("DummyData.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json();
    })
    .then((data) => {
      const images = data.images || [];
      const posts = data.posts || [];
      const comments = data.comments || [];

      console.log("Images:", images);
      console.log("Posts:", posts);
      console.log("Comments:", comments);

      // --- Calc averages ---
      const totalClicks = posts.reduce(
        (sum, post) => sum + post.clicks_count,
        0
      );
      const totalVotes = posts.reduce(
        (sum, post) => sum + post.up_vote_count + post.down_vote_count,
        0
      );
      const totalComments = posts.reduce(
        (sum, post) => sum + (post.comments_id ? post.comments_id.length : 0),
        0
      );

      const avgClicks = totalClicks / posts.length;
      const avgVotes = totalVotes / posts.length;
      const avgComments = totalComments / posts.length;

      document.getElementById("images-data-box").textContent = JSON.stringify(
        images,
        null,
        2
      );
      document.getElementById("posts-data-box").textContent = JSON.stringify(
        posts,
        null,
        2
      );
      document.getElementById("comments-data-box").textContent = JSON.stringify(
        comments,
        null,
        2
      );

      const summaryBox = document.getElementById("summary-box");
      summaryBox.innerHTML = `
        <h3>Averages</h3>
        <p><b>Average Clicks:</b> ${avgClicks.toFixed(2)}</p>
        <p><b>Average Votes (Up + Down):</b> ${avgVotes.toFixed(2)}</p>
        <p><b>Average Comments per Post:</b> ${avgComments.toFixed(2)}</p>
      `;
      summaryBox.style.display = "block";

      const normalizedBox = document.getElementById("normalized-box");
      let normalizedHTML = "<h3> Normalized Data per Post</h3>";

      posts.forEach((post, index) => {
        const clicksNorm = (post.clicks_count / avgClicks).toFixed(2);
        const votesNorm = (
          (post.up_vote_count + post.down_vote_count) /
          avgVotes
        ).toFixed(2);
        const commentsNorm = (
          (post.comments_id ? post.comments_id.length : 0) / avgComments
        ).toFixed(2);

        normalizedHTML += `
          <div class="normalized-post-box-card">
            <b>Post ${index + 1}</b><br>
            Post ID: ${post.post_id}<br>
            Normalized Clicks: ${clicksNorm}<br>
            Normalized Votes: ${votesNorm}<br>
            Normalized Comments: ${commentsNorm}
          </div>
        `;
      });

      normalizedBox.innerHTML = normalizedHTML;
      normalizedBox.style.display = "block";
    })
    .catch((error) => {
      const msg = "Error fetching data: " + error;
      document.getElementById("images-data-box").textContent = msg;
      document.getElementById("posts-data-box").textContent = msg;
      document.getElementById("comments-data-box").textContent = msg;
    });
});
