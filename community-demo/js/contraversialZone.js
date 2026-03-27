function contraversialZone(post) {
  console.log("POST: ", post);

  if (post == null) {
    console.log("post not found, returning false");
    return false;
  }
  const SECONDS_IN_HOUR = 60 * 60;

  const MIN_TOTAL_VOTES = 50;
  const twentyFourHours = 24 * SECONDS_IN_HOUR;
  const seventyTwoHours = 72 * SECONDS_IN_HOUR;

  const currentTime = Math.floor(Date.now() / 1000);
  const contraversialUnix = post.contaversial_since;
  const timeDifference = currentTime - contraversialUnix;

  if (timeDifference < twentyFourHours || timeDifference >= seventyTwoHours) {
    return false;
  }

  const up_vote_count = post.up_vote_count || 0;
  const down_vote_count = post.down_vote_count || 0; 
  var contraversialLevel = 0;
  const multiplier = 100;
  const totalVotes = up_vote_count + down_vote_count;

  if (totalVotes == 0) {
    return false;
  }

  if (totalVotes < MIN_TOTAL_VOTES) {
    return false;
  }

  // contraversialLevel =
  //   (up_vote_count / (up_vote_count + down_vote_count)) * multiplier;

  const controversialSince = Number(post.controversial_since) || null;
  if (!controversialSince) {
    return false;
  }

   const timeDiff = currentTime - controversialSince;

  const BOOST_START_HOURS = 48; // after 48h in 40–60
  const BOOST_DURATION_HOURS = 48; // boost lasts 48h
  const boostStart = BOOST_START_HOURS * SECONDS_IN_HOUR;          // 48h
  const boostEnd = (BOOST_START_HOURS + BOOST_DURATION_HOURS) * SECONDS_IN_HOUR; // 96h

  const level = (up_vote_count / totalVotes) * 100;

  const inZone = level >= 40 && level <= 60;
  if (!inZone) {
    return false;
  }

   if (timeDiff < boostStart || timeDiff >= boostEnd) {
    return false;
  }

  return true;

  // console.log("contraversialLevel: ", contraversialLevel)
  // if (contraversialLevel < 61 && contraversialLevel > 39) {
  //     return true;
  // }else{
  //   return false
  // }
}

window.contraversialZone = contraversialZone;

