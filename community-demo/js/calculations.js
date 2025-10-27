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

      // console.log("Images:", images);
      // console.log("Posts:", posts);
      // console.log("Comments:", comments);

      // Calc avgs
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
      let normalizedHTML = "<h3> Data per Post</h3>";

      var clicksNorm;
      var votesNorm;
      var commentsNorm;

      var numOfVotes;
      var numOfClicks;
      var numOfComments;

      const commentsWeight = 0.3;
      const clicksWeight = 0.1;
      const votesWeight = 0.6;

      var weightedVotes;
      var weightedClicks;
      var weightedComments;
      var weightedTotal;

      var currentTime = Math.floor(Date.now() / 1000); //UNIX
      var postTime;
      var timeResult;
      const constantOffset = 2;
      const gravity = 1.2;

      var postFinalScore;

      var postScores = {};
      var commentsHTML = "";

      var parentChildCommentsMap = {};
      var postComments = [];

      var commentsPerPost = {};


      posts.forEach((post, index) => {
        commentsHTML = "";
        postComments = post.comments_id || [];

        numOfVotes = post.up_vote_count + post.down_vote_count;
        numOfClicks = post.clicks_count;
        numOfComments = post.comments_id ? post.comments_id.length : 0;

        clicksNorm = Number((numOfClicks / avgClicks).toFixed(2));
        votesNorm = Number((numOfVotes / avgVotes).toFixed(2));
        commentsNorm = Number((numOfComments / avgComments).toFixed(2));

        //Weighted Scores
        weightedVotes = votesNorm * votesWeight;
        weightedClicks = clicksNorm * clicksWeight;
        weightedComments = commentsNorm * commentsWeight;
        weightedTotal = weightedVotes + weightedClicks + weightedComments;

        //Time Decay Calculation
        postTime = post.created_at;

        const hoursSincePost = (currentTime - post.created_at) / 3600;
        const gravitatedTime = Math.pow(
          hoursSincePost + constantOffset,
          gravity
        );

        postFinalScore = weightedTotal / gravitatedTime;
        postScores[post.post_id] = postFinalScore;

        // COMMENTS
        parentChildCommentsMap = {};

        // find parents first
        postComments.forEach((cid) => {
          const comment = comments.find((c) => c.comment_id === cid);
          if (comment && comment.parent_comment_id === null) {
            parentChildCommentsMap[comment.comment_id] = [];
          }
        });

        // assign children
        postComments.forEach((cid) => {
          const comment = comments.find((c) => c.comment_id === cid);
          if (comment && comment.parent_comment_id !== null) {
            if (parentChildCommentsMap[comment.parent_comment_id]) {
              parentChildCommentsMap[comment.parent_comment_id].push(
                comment.comment_id
              );
            }
          }
        });

        // Build HTML for comments
        for (const [parent, children] of Object.entries(
          parentChildCommentsMap
        )) {
          if (children.length > 0) {
            commentsHTML += `Parent: ${parent}, Child: ${children.join(
              ", "
            )}<br>`;
          } else {
            commentsHTML += `Parent: ${parent}<br>`;
          }
        }

        commentsPerPost[post.post_id] = postComments
        normalizedHTML += `
          <div class="normalized-post-box-card">
            <b>Post ${index + 1}</b><br>
            Post ID: ${post.post_id}
            <br><br>
            Number of Votes: ${numOfVotes}<br>
            Number of Comments: ${numOfClicks}<br>
            Number of Clicks: ${numOfComments}<br>

            <b>Comments:</b><br>
            ${commentsHTML}
      
          </div>
        `;
      });

      normalizedBox.innerHTML = normalizedHTML;
      normalizedBox.style.display = "block";

      const postsSorted = Object.entries(postScores).sort(
        (a, b) => b[1] - a[1]
      );
      console.log("sorted posts: ", postsSorted);

      const sortedPostsBox = document.getElementById("sorted-posts-box");
      let sortedHTML = "";

      postsSorted.forEach(([postId, score], index) => {
        const post = posts.find((p) => p.post_id == postId);
        const image = images.find((img) => img.image_id == post.image_id);

        sortedHTML += `
          <div class="sorted-post-card">
            <div>Score: ${score.toFixed(9)}</div>
            <div class="post-above-image">
            Post ID: ${post.post_id}
            Posted by: ${post.user_id}
            </div>
             <div class="sorted-posts-image"></div>

            <div class="post-description">"${post.text}"</div>

            <div class="post-under-image">
            Clicks: <p class="data-number-post-card">${post.clicks_count} <p>
            N.O. comments: <p class="data-number-post-card">${
              post.comments_id.length
            }<p>
            </div>
            <div class="post-under-image">

            Upvotes: <p class="data-number-post-card">${post.up_vote_count} <p>
            Downvotes: <p class="data-number-post-card">${
              post.down_vote_count
            }<p>
            </div>
           
            <div class="post-under-image">
            Total votes: <p class="data-number-post-card">${
              post.up_vote_count + post.down_vote_count
            } <p>
            </div>


              <b>Comments:</b><br>

          </div><br>
        `;
      });

      sortedPostsBox.innerHTML = sortedHTML;
      sortedPostsBox.style.display = "flex";
    })
    .catch((error) => {
      const msg = "Error fetching data: " + error;
      document.getElementById("images-data-box").textContent = msg;
      document.getElementById("posts-data-box").textContent = msg;
      document.getElementById("comments-data-box").textContent = msg;
    });
});
