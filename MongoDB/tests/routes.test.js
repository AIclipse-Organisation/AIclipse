const request = require('supertest');

// make sure JWT_SECRET exists BEFORE requiring controllers
process.env.JWT_SECRET = process.env.JWT_SECRET;

const app = require('../test_routes_controllers');
const { connectTestDB, disconnectTestDB } = require('../test_db');

const Post = require('../mongo-models/community.posts.model');
const Comment = require('../mongo-models/community.comments.model');

jest.setTimeout(20000);

let authHeader = null;

beforeAll(async () => {
  await connectTestDB();

  // sign up a test user
  await request(app)
    .post('/auth/signup')
    .send({
      user_name: 'Tester',
      email: 'tester@example.com',
      password: 'secret123',
    })
    .expect(201);

  // login to get JWT
  const login = await request(app)
    .post('/auth/login')
    .send({
      email: 'tester@example.com',
      password: 'secret123',
    })
    .expect(200);

  authHeader = 'Bearer ' + login.body.token;
});


afterAll(async () => {
  await disconnectTestDB();
});

/* -------------------------------------------------------------------------- */
/*                             IMAGES API TEST                                */
/* -------------------------------------------------------------------------- */

describe('Images API', () => {
  test('create, fetch, delete an image', async () => {
    // create
    const create = await request(app)
      .post('/images')
      .set('Authorization', authHeader)
      .send({
        s3_key: 'folder/test-image.jpg',
        is_ai: true,
        score: 0.9,
        likelihood: 0.95,
      })
      .expect(201);

    const imageId = create.body.image_id;

    // fetch
    const fetched = await request(app)
      .get(`/images/${imageId}`)
      .expect(200);

    expect(fetched.body.image_id).toBe(imageId);
    expect(fetched.body.s3_key).toBe('folder/test-image.jpg');

    // delete
    const deleted = await request(app)
      .delete(`/images/${imageId}`)
      .expect(200);

    expect(deleted.body.deleted).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                        POSTS + COMMENTS API TEST                           */
/* -------------------------------------------------------------------------- */

describe('Posts + Comments API', () => {
  test('create 2 posts & 2 comments, delete 1 post & 1 comment', async () => {
    // 1) create base image (with required fields)
    const img = await request(app)
      .post('/images')
      .set('Authorization', authHeader)
      .send({
        s3_key: 'folder/post-image.jpg',
        is_ai: true,
        score: 0.8,
        likelihood: 0.9,
      })
      .expect(201);

    const imageId = img.body.image_id;

    // 2) create post 1
    const post1 = await request(app)
      .post('/posts')
      .set('Authorization', authHeader)
      .send({
        image_id: imageId,
        description: 'Post number one',
      })
      .expect(201);

    // 2) create post 2
    const post2 = await request(app)
      .post('/posts')
      .set('Authorization', authHeader)
      .send({
        image_id: imageId,
        description: 'Post number two',
      })
      .expect(201);

    const postId1 = post1.body.post_id;
    const postId2 = post2.body.post_id;

    // 3) comment #1 on post #1
    const comment1 = await request(app)
      .post('/comments')
      .set('Authorization', authHeader)
      .send({
        post_id: postId1,
        text: 'Comment A on post 1',
      })
      .expect(201);

    // 3) comment #2 on post #2
    const comment2 = await request(app)
      .post('/comments')
      .set('Authorization', authHeader)
      .send({
        post_id: postId2,
        text: 'Comment B on post 2',
      })
      .expect(201);

    const commentId1 = comment1.body.comment_id;
    const commentId2 = comment2.body.comment_id;

    // 4) delete comment #1
    const delComment = await request(app)
      .delete(`/comments/${commentId1}`)
      .set('Authorization', authHeader)
      .expect(200);

    expect(delComment.body.deleted).toBe(true);

    // 5) delete post #2
    const delPost = await request(app)
      .delete(`/posts/${postId2}`)
      .set('Authorization', authHeader)
      .expect(200);

    expect(delPost.body.deleted).toBe(true);

    // 6) validation: one post + one comment left
    const remainingPosts = await Post.countDocuments({});
    const remainingComments = await Comment.countDocuments({});

    expect(remainingPosts).toBe(1);
    expect(remainingComments).toBe(1);
  });
});
