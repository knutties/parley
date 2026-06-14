// github.js — thin wrapper over GitHub's GraphQL API and Models inference

const GQL_URL = "https://api.github.com/graphql";

export async function gql(token, query, variables = {}) {
  const r = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json();
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

export async function getViewer(token) {
  const d = await gql(
    token,
    `query { viewer { login avatarUrl name } }`
  );
  return d.viewer;
}

const DISCUSSION_COMMENT_PAGE_SIZE = 100;
const DISCUSSION_REPLY_PAGE_SIZE = 100;

const discussionCommentFields = `
  id body bodyHTML createdAt
  author { login avatarUrl }
`;

export async function listDiscussions(token, owner, name, first = 30, after = null) {
  const d = await gql(
    token,
    `query($owner:String!, $name:String!, $first:Int!, $after:String) {
      repository(owner:$owner, name:$name) {
        id
        discussions(first:$first, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id number title updatedAt
            author { login }
            comments { totalCount }
            category { name emoji }
          }
        }
      }
    }`,
    { owner, name, first, after }
  );
  return {
    repoId: d.repository.id,
    discussions: d.repository.discussions.nodes,
    pageInfo: d.repository.discussions.pageInfo,
    totalCount: d.repository.discussions.totalCount,
  };
}

export async function getDiscussion(token, owner, name, number) {
  const firstPage = await fetchDiscussionCommentPage(
    token,
    owner,
    name,
    number,
    null
  );
  const discussion = firstPage.repository.discussion;
  if (!discussion) return null;

  let commentConnection = discussion.comments;
  const comments = [...commentConnection.nodes];

  while (commentConnection.pageInfo.hasNextPage) {
    const nextPage = await fetchDiscussionCommentPage(
      token,
      owner,
      name,
      number,
      commentConnection.pageInfo.endCursor
    );
    commentConnection = nextPage.repository.discussion.comments;
    comments.push(...commentConnection.nodes);
  }

  for (const comment of comments) {
    await fetchAllReplies(token, comment);
  }

  discussion.comments = {
    ...discussion.comments,
    nodes: comments,
    pageInfo: {
      hasNextPage: false,
      endCursor: commentConnection.pageInfo.endCursor,
    },
  };
  discussion.parleyPageInfo = buildDiscussionPageInfo(discussion);
  return discussion;
}

async function fetchDiscussionCommentPage(token, owner, name, number, after) {
  return gql(
    token,
    `query($owner:String!, $name:String!, $number:Int!, $commentsFirst:Int!, $commentsAfter:String, $repliesFirst:Int!) {
      repository(owner:$owner, name:$name) {
        discussion(number:$number) {
          id number title body bodyHTML createdAt updatedAt url
          author { login avatarUrl }
          category { name emoji }
          comments(first:$commentsFirst, after:$commentsAfter) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              ${discussionCommentFields}
              replies(first:$repliesFirst) {
                totalCount
                pageInfo { hasNextPage endCursor }
                nodes {
                  ${discussionCommentFields}
                }
              }
            }
          }
        }
      }
    }`,
    {
      owner,
      name,
      number,
      commentsFirst: DISCUSSION_COMMENT_PAGE_SIZE,
      commentsAfter: after,
      repliesFirst: DISCUSSION_REPLY_PAGE_SIZE,
    }
  );
}

async function fetchAllReplies(token, comment) {
  let replyConnection = comment.replies;
  const replies = [...replyConnection.nodes];

  while (replyConnection.pageInfo.hasNextPage) {
    const d = await gql(
      token,
      `query($commentId:ID!, $first:Int!, $after:String) {
        node(id:$commentId) {
          ... on DiscussionComment {
            replies(first:$first, after:$after) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes {
                ${discussionCommentFields}
              }
            }
          }
        }
      }`,
      {
        commentId: comment.id,
        first: DISCUSSION_REPLY_PAGE_SIZE,
        after: replyConnection.pageInfo.endCursor,
      }
    );
    replyConnection = d.node.replies;
    replies.push(...replyConnection.nodes);
  }

  comment.replies = {
    ...comment.replies,
    nodes: replies,
    pageInfo: {
      hasNextPage: false,
      endCursor: replyConnection.pageInfo.endCursor,
    },
  };
}

function buildDiscussionPageInfo(discussion) {
  const commentsLoaded = discussion.comments.nodes.length;
  const commentsTotal = discussion.comments.totalCount ?? commentsLoaded;
  let repliesLoaded = 0;
  let repliesTotal = 0;
  for (const comment of discussion.comments.nodes) {
    repliesLoaded += comment.replies.nodes.length;
    repliesTotal += comment.replies.totalCount ?? comment.replies.nodes.length;
  }
  const info = {
    comments: {
      loadedCount: commentsLoaded,
      totalCount: commentsTotal,
      complete: commentsLoaded >= commentsTotal && !discussion.comments.pageInfo.hasNextPage,
    },
    replies: {
      loadedCount: repliesLoaded,
      totalCount: repliesTotal,
      complete: repliesLoaded >= repliesTotal,
    },
  };
  info.complete = info.comments.complete && info.replies.complete;
  return info;
}

export async function addComment(token, discussionId, body, replyToId = null) {
  const input = { discussionId, body };
  if (replyToId) input.replyToId = replyToId;
  const d = await gql(
    token,
    `mutation($input:AddDiscussionCommentInput!) {
      addDiscussionComment(input:$input) {
        comment { id body createdAt author { login avatarUrl } }
      }
    }`,
    { input }
  );
  return d.addDiscussionComment.comment;
}

// ------- GitHub Models -------

// Fetch the live catalog of models available on GitHub Models.
//
// The catalog endpoint does not return CORS headers, so the call from a
// browser origin has to be relayed through the same Cloudflare Worker
// that fronts the OAuth device-flow endpoints. When `proxy` is given,
// the URL is rewritten to `<proxy><encoded target>`; when it isn't, we
// attempt a direct fetch (works locally, fails in production).
//
// Response shape is defensive-parsed: GitHub has returned either a flat
// array or { data: [...] } / { models: [...] } at various points.
export async function listModels(token, proxy = null) {
  const target = "https://models.github.ai/catalog/models";
  const url = proxy ? proxy + encodeURIComponent(target) : target;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Catalog fetch failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  const json = await r.json();
  const list = Array.isArray(json) ? json : (json.data || json.models || []);
  return list;
}

export async function chatCompletion(token, endpoint, model, messages, signal) {
  const r = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1500,
      temperature: 0.7,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Model call failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  const json = await r.json();
  return json.choices?.[0]?.message?.content ?? "";
}
