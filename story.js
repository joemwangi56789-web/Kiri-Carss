import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit,
  orderBy, query, serverTimestamp, setDoc, where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const root = document.getElementById("storyArticle");
const id = new URLSearchParams(location.search).get("id");
let currentUser = null;
let currentProfile = null;
let currentStory = null;
let actionArea = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setMessage(node, text, isError = false) {
  node.textContent = text;
  node.style.color = isError ? "#b42318" : "#174a88";
}

async function loadProfile(user) {
  if (!user) {
    currentProfile = null;
    return;
  }
  let snapshot = await getDoc(doc(db, "buyers", user.uid));
  if (snapshot.exists()) currentProfile = snapshot.data();
  else {
    snapshot = await getDoc(doc(db, "admins", user.uid));
    currentProfile = snapshot.exists() ? snapshot.data() : null;
  }
}

function isActiveAccount() {
  return !!currentUser && !!currentProfile && currentProfile.active !== false
    && !["suspended", "banned"].includes(currentProfile.accountStatus);
}

function isAllowedEmbedUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:"
      && ((url.hostname === "www.youtube-nocookie.com" && parts[0] === "embed" && /^[A-Za-z0-9_-]{6,20}$/.test(parts[1] || ""))
        || (url.hostname === "player.vimeo.com" && parts[0] === "video" && /^[0-9]{5,15}$/.test(parts[1] || "")));
  } catch {
    return false;
  }
}

function renderStory(story) {
  root.replaceChildren();
  const title = element("h1", story.title || "Untitled story");
  const meta = element("div",
    (story.authorName || "Community author") + " · " +
    (story.category || "Story") + " · " +
    (story.createdAt?.toDate ? story.createdAt.toDate().toLocaleDateString("en-KE") : "Recently published"),
    "story-meta"
  );
  root.append(title, meta);

  if (story.excerpt) {
    const excerpt = element("p", story.excerpt);
    excerpt.style.fontWeight = "700";
    root.appendChild(excerpt);
  }

  for (const block of story.blocks || []) {
    if (block.type === "text") {
      root.appendChild(element("p", block.text || ""));
    } else if (block.type === "image" && block.url?.startsWith("https://")) {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = block.url;
      image.alt = block.caption || story.title || "Story image";
      image.loading = "lazy";
      figure.appendChild(image);
      if (block.caption) figure.appendChild(element("figcaption", block.caption));
      root.appendChild(figure);
    } else if (block.type === "video" && isAllowedEmbedUrl(block.embedUrl)) {
      const figure = document.createElement("figure");
      const frame = document.createElement("iframe");
      frame.src = block.embedUrl;
      frame.title = story.title || "Kiri Stories video";
      frame.loading = "lazy";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      figure.appendChild(frame);
      root.appendChild(figure);
    } else if (block.type === "video" && isAllowedEmbedUrl(block.embedUrl)) {
      const figure = document.createElement("figure");
      const frame = document.createElement("iframe");
      frame.src = block.embedUrl;
      frame.title = story.title || "Kiri Stories video";
      frame.loading = "lazy";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      figure.appendChild(frame);
      root.appendChild(figure);
    }
  }

  root.appendChild(element("p", "This article is the responsibility of its author.", "story-meta"));
  actionArea = element("section", undefined, "story-actions-area");
  root.appendChild(actionArea);
  renderActions();
}

async function renderActions() {
  if (!currentStory || !actionArea) return;
  actionArea.replaceChildren();

  if (currentUser?.uid === currentStory.authorId) {
    const edit = element("a", "Edit your story", "story-btn secondary");
    edit.href = "story-editor.html?id=" + encodeURIComponent(id);
    actionArea.appendChild(edit);
  }

  const stats = element("p", "Loading story activity…", "story-status");
  actionArea.appendChild(stats);
  try {
    const likesRef = collection(db, "stories", id, "likes");
    const commentsRef = collection(db, "stories", id, "comments");
    const ratingsRef = collection(db, "stories", id, "ratings");
    const [likes, comments, ratings, myLike, myRating] = await Promise.all([
      getDocs(likesRef),
      getDocs(query(commentsRef, whereVisibleComments(), orderBy("createdAt", "asc"), limit(100))),
      getDocs(ratingsRef),
      currentUser ? getDoc(doc(db, "stories", id, "likes", currentUser.uid)) : Promise.resolve(null),
      currentUser ? getDoc(doc(db, "stories", id, "ratings", currentUser.uid)) : Promise.resolve(null)
    ]);
    const ratingValues = ratings.docs.map(item => Number(item.data().rating)).filter(value => value >= 1 && value <= 5);
    const average = ratingValues.length
      ? (ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(1)
      : "No ratings";
    stats.textContent = likes.size + " likes · " + comments.size + " comments · " +
      (ratingValues.length ? average + "/5 from " + ratingValues.length + " ratings" : average);

    const controls = element("div", undefined, "story-toolbar");
    const likeButton = element("button", (myLike?.exists() ? "Unlike" : "Like") + " (" + likes.size + ")", "story-btn");
    likeButton.type = "button";
    likeButton.disabled = !isActiveAccount();
    likeButton.addEventListener("click", async () => {
      if (!isActiveAccount()) {
        setMessage(stats, "Sign in with an active Kiri Cars account to like this story.", true);
        return;
      }
      likeButton.disabled = true;
      try {
        const ref = doc(db, "stories", id, "likes", currentUser.uid);
        if (myLike?.exists()) await deleteDoc(ref);
        else await setDoc(ref, { userId: currentUser.uid, createdAt: serverTimestamp() });
        await renderActions();
      } catch (error) {
        console.error(error);
        setMessage(stats, "Could not update your like: " + (error.code || error.message), true);
        likeButton.disabled = false;
      }
    });
    controls.appendChild(likeButton);

    const ratingLabel = element("label", "Your rating");
    const ratingSelect = document.createElement("select");
    ratingSelect.setAttribute("aria-label", "Rate this story");
    for (let value = 5; value >= 1; value--) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = value + " star" + (value === 1 ? "" : "s");
      ratingSelect.appendChild(option);
    }
    if (myRating?.exists()) ratingSelect.value = String(myRating.data().rating);
    ratingSelect.disabled = !isActiveAccount();
    const rateButton = element("button", "Submit rating", "story-btn secondary");
    rateButton.type = "button";
    rateButton.disabled = !isActiveAccount();
    rateButton.addEventListener("click", async () => {
      if (!isActiveAccount()) {
        setMessage(stats, "Sign in with an active Kiri Cars account to rate this story.", true);
        return;
      }
      rateButton.disabled = true;
      try {
        const ref = doc(db, "stories", id, "ratings", currentUser.uid);
        const exists = myRating?.exists();
        await setDoc(ref, {
          userId: currentUser.uid,
          rating: Number(ratingSelect.value),
          ...(exists ? {} : { createdAt: serverTimestamp() }),
          updatedAt: serverTimestamp()
        }, { merge: true });
        await renderActions();
      } catch (error) {
        console.error(error);
        setMessage(stats, "Could not save your rating: " + (error.code || error.message), true);
        rateButton.disabled = false;
      }
    });
    const ratingWrap = element("div", undefined, "story-field");
    ratingWrap.append(ratingLabel, ratingSelect, rateButton);
    controls.appendChild(ratingWrap);

    if (currentProfile?.role === "buyer" && isActiveAccount()) {
      const share = element("button", "Share story", "story-btn secondary");
      share.type = "button";
      share.addEventListener("click", async () => {
        const url = new URL("story.html?id=" + encodeURIComponent(id), location.href).href;
        try {
          if (navigator.share) await navigator.share({ title: currentStory.title, url });
          else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            setMessage(stats, "Story link copied. You can share it with another buyer.");
          } else {
            window.prompt("Copy this story link:", url);
          }
        } catch (error) {
          if (error.name !== "AbortError") setMessage(stats, "Could not share the story link.", true);
        }
      });
      controls.appendChild(share);
    }
    actionArea.appendChild(controls);

    const commentsHeading = element("h2", "Comments");
    actionArea.appendChild(commentsHeading);
    const commentsList = element("div", undefined, "story-comments");
    if (comments.empty) commentsList.appendChild(element("p", "No comments yet. Start the conversation."));
    comments.forEach(item => {
      const data = item.data();
      const card = element("article", undefined, "story-comment");
      card.append(element("strong", data.authorName || "Kiri Cars user"));
      card.append(element("p", data.text || ""));
      if (currentUser && (currentUser.uid === data.authorId || currentProfile?.role === "owner")) {
        const remove = element("button", "Delete comment", "story-btn secondary");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          if (!confirm("Delete this comment?")) return;
          try {
            await deleteDoc(item.ref);
            await renderActions();
          } catch (error) {
            setMessage(stats, "Could not delete comment: " + (error.code || error.message), true);
          }
        });
        card.appendChild(remove);
      }
      commentsList.appendChild(card);
    });
    actionArea.appendChild(commentsList);

    const form = document.createElement("form");
    form.className = "story-comment-form";
    const input = document.createElement("textarea");
    input.maxLength = 1000;
    input.required = true;
    input.placeholder = "Write a respectful comment…";
    input.disabled = !isActiveAccount();
    const submit = element("button", "Post comment", "story-btn");
    submit.type = "submit";
    submit.disabled = !isActiveAccount();
    form.append(input, submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || !isActiveAccount()) return;
      submit.disabled = true;
      try {
        await addDoc(commentsRef, {
          authorId: currentUser.uid,
          authorName: currentProfile.name || currentUser.email || "Kiri Cars user",
          text,
          status: "visible",
          createdAt: serverTimestamp()
        });
        await renderActions();
      } catch (error) {
        console.error(error);
        setMessage(stats, "Could not post your comment: " + (error.code || error.message), true);
        submit.disabled = false;
      }
    });
    actionArea.appendChild(form);

    addReportControls(stats);
  } catch (error) {
    console.error(error);
    setMessage(stats, "Could not load story activity: " + (error.code || error.message), true);
  }
}

function whereVisibleComments() {
  return where("status", "==", "visible");
}

function addReportControls(statusNode) {
  const area = element("div", undefined, "story-report-area");
  area.appendChild(element("h3", "See a problem with this story?"));
  const button = element("button", "Report this story", "story-btn secondary");
  button.type = "button";
  const message = element("p", "", "story-status");
  button.addEventListener("click", async () => {
    if (!isActiveAccount()) {
      setMessage(message, "Please sign in with an active account to report a story.", true);
      return;
    }
    const reason = prompt("Why are you reporting this story? Enter: inappropriate content, harassment, misinformation, copyright, or other.");
    if (!reason?.trim()) return;
    const details = prompt("Add details to help the Kiri Cars team review this report (optional).") || "";
    button.disabled = true;
    try {
      await addDoc(collection(db, "storyReports"), {
        storyId: id,
        storyTitle: currentStory.title || "",
        storyAuthorId: currentStory.authorId || "",
        reporterId: currentUser.uid,
        reason: reason.trim().slice(0, 100),
        details: details.trim().slice(0, 1000),
        status: "open",
        createdAt: serverTimestamp()
      });
      setMessage(message, "Thank you. Your report has been sent to the Kiri Cars moderation team.");
      button.textContent = "Report submitted";
    } catch (error) {
      console.error(error);
      setMessage(message, "Could not submit your report: " + (error.code || error.message), true);
      button.disabled = false;
    }
  });
  area.append(button, message);
  actionArea.appendChild(area);
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  try {
    await loadProfile(user);
    if (currentStory) await renderActions();
  } catch (error) {
    console.error(error);
  }
});

if (!id) {
  root.textContent = "No story selected.";
} else {
  try {
    const snapshot = await getDoc(doc(db, "stories", id));
    if (!snapshot.exists() || snapshot.data().status !== "published") {
      root.textContent = "This story is unavailable.";
    } else {
      currentStory = snapshot.data();
      document.title = currentStory.title + " | Kiri Stories";
      renderStory(currentStory);
    }
  } catch (error) {
    console.error(error);
    root.textContent = "Could not load this story.";
  }
}
