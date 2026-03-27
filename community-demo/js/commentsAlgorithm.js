function calculateCommentScores(posts, comments) {
  const commentsMap = Object.fromEntries(
    comments.map((c) => [c.comment_id, c])
  );
  const repliesCountMap = {};

  comments.forEach((c) => {
    if (c.parent_comment_id) {
      repliesCountMap[c.parent_comment_id] =
        (repliesCountMap[c.parent_comment_id] || 0) + 1;
    }
  });

  const postCommentScores = {};

  posts.forEach((post) => {
    const scoredComments = (post.comments_id || [])
      .map((cid) => {
        const comment = commentsMap[cid];
        if (!comment) return null;

        //score for length
        const length_chars = (comment.text || "").length;
        const bl = 0.6 * (Math.min(length_chars, 150) / 150);

        //score for replies
        const numReplies = repliesCountMap[comment.comment_id] || 0;
        const br = 0.12 * Math.min(numReplies, 10);

        //score for votes
        const upvotes = comment.up_vote_count || 0;
        const downvotes = comment.down_vote_count || 0;
        const totalVotes = upvotes + downvotes;
        let bv = 0;
        if (totalVotes > 100) bv = 0.2;
        else if (totalVotes > 60) bv = 0.15;
        else if (totalVotes > 30) bv = 0.1;
        else if (totalVotes > 10) bv = 0.05;

        //final score
        const score = 1 + bl + br + bv;
        return { comment_id: comment.comment_id, bl, br, bv, score };
      })
      .filter(Boolean);

    //sum scores for the post

    //outputing just the score
    //const totalScore = scoredComments.reduce((sum, c) => sum + c.score, 0);
    //postCommentScores[post.post_id] = totalScore;

    //outputing everything to the post
    const sumBl = scoredComments.reduce((sum, c) => sum + c.bl, 0);
    const sumBr = scoredComments.reduce((sum, c) => sum + c.br, 0);
    const sumBv = scoredComments.reduce((sum, c) => sum + c.bv, 0);
    const totalScore = scoredComments.reduce((sum, c) => sum + c.score, 0);

    postCommentScores[post.post_id] = {
      totalScore,
      comments: scoredComments,
      sumBl,
      sumBr,
      sumBv,
    };
  });

  return postCommentScores; //{ postId: { totalScore, comments: [...], sumBl, sumBr, sumBv}}
}

window.calculateCommentScores = calculateCommentScores;
