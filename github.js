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

export async function listDiscussions(token, owner, name, first = 30) {
  const d = await gql(
    token,
    `query($owner:String!, $name:String!, $first:Int!) {
      repository(owner:$owner, name:$name) {
        id
        discussions(first:$first, orderBy:{field:UPDATED_AT, direction:DESC}) {
          nodes {
            id number title updatedAt
            author { login }
            comments { totalCount }
            category { name emoji }
          }
        }
      }
    }`,
    { owner, name, first }
  );
  return {
    repoId: d.repository.id,
    discussions: d.repository.discussions.nodes,
  };
}

export async function getDiscussion(token, owner, name, number) {
  const d = await gql(
    token,
    `query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        discussion(number:$number) {
          id number title body bodyHTML createdAt updatedAt url
          author { login avatarUrl }
          category { name emoji }
          comments(first:100) {
            nodes {
              id body bodyHTML createdAt
              author { login avatarUrl }
              replies(first:50) {
                nodes {
                  id body bodyHTML createdAt
                  author { login avatarUrl }
                }
              }
            }
          }
        }
      }
    }`,
    { owner, name, number }
  );
  return d.repository.discussion;
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
