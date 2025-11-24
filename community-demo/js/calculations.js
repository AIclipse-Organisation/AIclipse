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

      //comments score calculation
      const postCommentScores = calculateCommentScores(posts, comments);
      const totalCommentScore = Object.values(postCommentScores).reduce(
        (sum, p) => sum + p.totalScore,
        0
      );
      const avgCommentScore = totalCommentScore / posts.length || 1;

      // console.log("calculations.js start *****");
      // console.log("postCommentScores: ", postCommentScores);
      // console.log("totalCommentScore: ", totalCommentScore);
      // console.log("avgCommentScore: ", avgCommentScore);

      // Calc avgs
      const totalClicks = posts.reduce(
        (sum, post) => sum + post.clicks_count,
        0
      );
      const totalVotes = posts.reduce(
        (sum, post) => sum + post.up_vote_count + post.down_vote_count,
        0
      );
      // const totalComments = posts.reduce(
      //   (sum, post) => sum + (post.comments_id ? post.comments_id.length : 0),
      //   0
      // );

      const avgClicks = totalClicks / posts.length;
      const avgVotes = totalVotes / posts.length;
      // const avgComments = totalComments / posts.length;

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

      const totalCommentsNoComAlg = posts.reduce(
        (sum, post) => sum + (post.comments_id ? post.comments_id.length : 0),
        0
      );
      const avgCommentsNoComAlg = totalCommentsNoComAlg / posts.length;

      const summaryBox = document.getElementById("summary-box");
      summaryBox.innerHTML = `
        <h3>Averages</h3>
        <p><b>Average Clicks:</b> ${avgClicks.toFixed(2)}</p>
        <p><b>Average Votes (Up + Down):</b> ${avgVotes.toFixed(2)}</p>
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
      var weightedCommentsJustSum;
      var weightedTotalWithoutCommentAlg;

      var currentTime = Math.floor(Date.now() / 1000); //UNIX
      var postTime;
      var timeResult;
      const constantOffset = 2;
      const gravity = 1.2;

      var postFinalScore;
      var postFinalScoreNoComAlg;

      var postScores = {};
      var postScoresNoComAlg = {};

      var commentsHTML = "";

      var parentChildCommentsMap = {};
      var postComments = [];

      var commentsPerPost = {};
      var postContraversial;

      posts.forEach((post, index) => {
        postContraversial = false;
        console.log("contraversial zone");
        postContraversial = contraversialZone(post);
        console.log(
          "contraversial zone closed: postContraversial: ",
          postContraversial, "for post: ", post
        );
        commentsHTML = "";
        postComments = post.comments_id || [];

        numOfVotes = post.up_vote_count + post.down_vote_count;
        numOfClicks = post.clicks_count;

        clicksNorm = Number((numOfClicks / avgClicks).toFixed(2));
        votesNorm = Number((numOfVotes / avgVotes).toFixed(2));

        //comments
        const commentScoreObj = postCommentScores[post.post_id];
        const commentTotalScore =
          commentScoreObj && commentScoreObj.totalScore
            ? commentScoreObj.totalScore
            : 0;

        commentsNorm =
          avgCommentScore > 0
            ? Number((commentTotalScore / avgCommentScore).toFixed(2))
            : 0;

        //Weighted Scores
        weightedVotes = votesNorm * votesWeight;
        weightedClicks = clicksNorm * clicksWeight;
        weightedComments = commentsNorm * commentsWeight;
        weightedTotal = weightedVotes + weightedClicks + weightedComments;

        numOfComments = post.comments_id ? post.comments_id.length : 0;
        // console.log("test22: ");

        // commentsNorm = Number((numOfComments / avgCommentsNoComAlg).toFixed(2));
        weightedCommentsJustSum = commentsNorm * commentsWeight;

        weightedTotalWithoutCommentAlg =
          weightedVotes + weightedClicks + weightedCommentsJustSum;

        //Time Decay Calculation
        // Time Decay Calculation
        // console.log(
        //   "Post",
        //   post.post_id,
        //   "weightedVotes:",
        //   weightedVotes,
        //   "weightedClicks:",
        //   weightedClicks,
        //   "weightedComments:",
        //   weightedComments,
        //   "weightedTotal:",
        //   weightedTotal
        // );

        // console.log("ageInSeconds:", currentTime - post.created_at);
        // console.log("post.created_at:", post.created_at);

        //post time bonus
        postTime = post.created_at;

        const ageInSeconds = Math.max(currentTime - postTime, 0);
        const ageInHours = ageInSeconds / 3600;
        const engagement =
          clicksNorm * clicksWeight +
          votesNorm * votesWeight +
          commentsNorm * commentsWeight;
        const timeFactor = Math.pow(ageInHours + constantOffset, gravity);

        let score = engagement / timeFactor;
        let scoreWithoutPostDecay = engagement;
        console.log("score: ", score * 1000)

        if (ageInHours < 24) score *= 1.2;
        console.log("score: after ageInHours: ", score* 1000)


        console.log("score: before postContraversial: ", score* 1000)

        if (postContraversial) score *= 2.5;

        console.log("score: after postContraversial: ", score* 1000)

        // let timeBonus = 0;

        // if (ageInHours < 48) {
        //   //first 2 days: strong boost
        //   timeBonus = 999;
        // } else if (ageInHours < 96 && ageInHours > 48) {
        //   //2–4 days: medium boost
        //   timeBonus = 1.5;
        // } else if (ageInHours < 168 && ageInHours > 96) {
        //   //4–7 days: light boost
        //   timeBonus = 1;
        //   weightedTotal = weightedTotal * 0.7;
        // } else if (ageInHours < 240 && ageInHours > 168) {
        //   //7–10 days: fading
        //   timeBonus = 0.5;
        //   weightedTotal = weightedTotal * 0.6;
        // } else {
        //   //older than 10 days: no time bonus
        //   timeBonus = 0;
        //   weightedTotal = 0;
        //   weightedTotalWithoutCommentAlg = 0;
        //   weightedTotal = 0;
        // }

        // //Final score
        // postFinalScore = score ;
        // // postFinalScore = weightedTotal + timeBonus;

        // postFinalScoreNoComAlg = score* 1000;
        // postFinalScoreNoComAlg = weightedTotalWithoutCommentAlg + timeBonus;

        console.log(post.post_id, postContraversial);
        // if (postContraversial) {
        //   postFinalScore = postFinalScore + 999;
        //   postFinalScoreNoComAlg = postFinalScoreNoComAlg + 999;
        // } else {
        //   postFinalScore = postFinalScore;
        //   postFinalScoreNoComAlg = postFinalScoreNoComAlg;
        // }

        postScores[post.post_id] = score* 10000;
        postScoresNoComAlg[post.post_id] = score* 10000;


        //COMMENTS
        parentChildCommentsMap = {};

        //find parents first
        postComments.forEach((cid) => {
          const comment = comments.find((c) => c.comment_id === cid);
          if (comment && comment.parent_comment_id === null) {
            parentChildCommentsMap[comment.comment_id] = [];
          }
        });

        //assign children
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

        //Build HTML for comments
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

        commentsPerPost[post.post_id] = postComments;

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
      
             Final Score: ${postFinalScore}<br><br>
             Final Score Without decay: ${scoreWithoutPostDecay}<br><br>


          </div>
        `;
      });

      normalizedBox.innerHTML = normalizedHTML;
      normalizedBox.style.display = "block";

      const postsSorted = Object.entries(postScores).sort(
        (a, b) => b[1] - a[1]
      );
      // console.log("sorted posts: ", postsSorted);

      const sortedPostsBox = document.getElementById("sorted-posts-box");
      let sortedHTML = "";

      postsSorted.forEach(([postId, score], index) => {
        const postScoreNoComAlg = postScoresNoComAlg[postId] || 0;

        const postScoreObj = postCommentScores[postId] || {
          totalScore: 0,
          comments: [],
        };
        const post = posts.find((p) => p.post_id == postId);
        const image = images.find((img) => img.image_id == post.image_id);
        // <div>Post Score (no comment alg): ${postScoreNoComAlg.toFixed(9)}</div>
        sortedHTML += `
        <div class="sorted-post-card">
          <div>Post Score (with comment alg): ${score.toFixed(9)}</div>
         
          <div class="post-above-image">
            Post ID: ${post.post_id} | Posted by: ${post.user_id}
          </div>
        
          <div class="post-description">${post.text}</div>

          <div class="post-under-image">
            Clicks: <p class="data-number-post-card">${post.clicks_count}</p>
            Comments: <p class="data-number-post-card">${
              post.comments_id ? post.comments_id.length : 0
            }</p>
            Comment Score: <p class="data-number-post-card">${postScoreObj.totalScore.toFixed(
              2
            )}</p>
          </div>

            <div class="post-under-image">
                <b>Breakdown per comment:</b><br>
                ${postScoreObj.comments
                  .map(
                    (c) =>
                      `ID:${c.comment_id} → Score:${c.score.toFixed(
                        2
                      )} (bl:${c.bl.toFixed(2)}, br:${c.br.toFixed(
                        2
                      )}, bv:${c.bv.toFixed(2)})`
                  )
                  .join("<br>")}
              </div>

          <div class="post-description">Uploaded: ${timeAgo(
            post.created_at
          )}</div>
          
          <div class="post-description">Contraversial since: ${timeAgo(
            post.controversial_since
          )}</div>
        </div><br>
      `;
      });

      sortedPostsBox.innerHTML = sortedHTML;
      sortedPostsBox.style.display = "flex";

      // console.log("postsSorted", postsSorted);
    })
    .catch((error) => {
      const msg = "Error fetching data: " + error;
      document.getElementById("images-data-box").textContent = msg;
      document.getElementById("posts-data-box").textContent = msg;
      document.getElementById("comments-data-box").textContent = msg;
    });
});

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  const intervalsOfSeconds = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [unit, value] of Object.entries(intervalsOfSeconds)) {
    const count = Math.floor(seconds / value);
    if (count >= 1) return `${count} ${unit}${count > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
