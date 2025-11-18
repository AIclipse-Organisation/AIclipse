function contraversialZone(post) {
  console.log("POST: ", post);

  if (post == null) {
    console.log("post not found, returning false");
    return false;
  }
  const SECONDS_IN_HOUR = 60 * 60;
  const twentyFourHours = 24 * SECONDS_IN_HOUR;
  const seventyTwoHours = 72 * SECONDS_IN_HOUR;

  const currentTime = Math.floor(Date.now() / 1000);
  const contraversialUnix = post.contaversial_since;
  const timeDifference = currentTime - contraversialUnix;

  if (timeDifference < twentyFourHours || timeDifference >= seventyTwoHours) {
    return false;
  }

  const up_vote_count = post.up_vote_count;
  const down_vote_count = post.down_vote_count;
  var contraversialLevel = 0;
  const multiplier = 100;
  const totalVotes = up_vote_count + down_vote_count;

  if (totalVotes == 0) {
    return false;
  }

  contraversialLevel =
    (up_vote_count / (up_vote_count + down_vote_count)) * multiplier;

  console.log("contraversialLevel: ", contraversialLevel)
  if (contraversialLevel < 61 && contraversialLevel > 39) {
      return true;
  }else{
    return false
  }
}

window.contraversialZone = contraversialZone;

