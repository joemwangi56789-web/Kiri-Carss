import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const CLOUD = "mlwi9tfu";
const PRESET = "kiri_cars_photos";
const TERMS = "2026-11-07";
const editId = new URLSearchParams(location.search).get("id");
const blocks = [];
const blocksEl = document.getElementById("storyBlocks");
const msg = document.getElementById("editorMessage");
const picker = document.getElementById("storyImagePicker");
const publish = document.getElementById("publishStory");
const acceptTermsLink = document.getElementById("acceptTermsLink");
const titleInput = document.getElementById("storyTitle");
const categoryInput = document.getElementById("storyCategory");
const excerptInput = document.getElementById("storyExcerpt");
const declaration = document.getElementById("authorDeclaration");
let user = null;
let profile = null;
let ready = false;

function say(text, isError = false) {
  msg.textContent = text;
  msg.style.color = isError ? "#b42318" : "#174a88";
}

function renderBlocks() {
  blocksEl.replaceChildren();
  blocks.forEach((block, index) => {
    const card = document.createElement("section");
    card.className = "story-block";
    const top = document.createElement("div");
    top.className = "story-block-top";
    const label = document.createElement("strong");
    label.textContent = (index + 1) + ". " + (block.type === "text" ? "Paragraph" : "Image");
    const actions = document.createElement("div");
    actions.className = "story-block-actions";

    const addAction = (text, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "story-btn secondary";
      button.textContent = text;
      button.addEventListener("click", action);
      actions.appendChild(button);
    };
    addAction("↑", () => moveBlock(index, -1));
    addAction("↓", () => moveBlock(index, 1));
    addAction("Remove", () => {
      blocks.splice(index, 1);
      renderBlocks();
    });
    top.append(label, actions);
    card.appendChild(top);

    if (block.type === "text") {
      const textarea = document.createElement("textarea");
      textarea.maxLength = 8000;
      textarea.placeholder = "Write this paragraph…";
      textarea.value = block.text || "";
      textarea.addEventListener("input", () => { block.text = textarea.value; });
      card.appendChild(textarea);
    } else if (block.type === "image") {
      const image = document.createElement("img");
      image.src = block.url;
      image.alt = block.caption || "Story image";
      const caption = document.createElement("input");
      caption.maxLength = 180;
      caption.placeholder = "Image caption (optional)";
      caption.value = block.caption || "";
      caption.addEventListener("input", () => { block.caption = caption.value; });
      card.append(image, caption);
    } else if (block.type === "video") {
      if (isAllowedEmbedUrl(block.embedUrl)) {
        const frame = document.createElement("iframe");
        frame.src = block.embedUrl;
        frame.title = "External video preview";
        frame.loading = "lazy";
        frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        frame.allowFullscreen = true;
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        card.appendChild(frame);
      }
      const note = document.createElement("p");
      note.textContent = isAllowedEmbedUrl(block.embedUrl)
        ? "Embedded from YouTube or Vimeo. The video is hosted by that platform."
        : "This video link is not supported. Remove it and add a YouTube or Vimeo link.";
      card.appendChild(note);
    }
    blocksEl.appendChild(card);
  });
}

function moveBlock(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= blocks.length) return;
  [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
  renderBlocks();
}

async function loadStoryForEditing() {
  const snapshot = await getDoc(doc(db, "stories", editId));
  if (!snapshot.exists()) throw new Error("This story could not be found.");
  const story = snapshot.data();
  if (story.authorId !== user.uid || story.status !== "published") {
    throw new Error("You can edit only your own published stories.");
  }
  titleInput.value = story.title || "";
  categoryInput.value = story.category || "Automotive";
  excerptInput.value = story.excerpt || "";
  blocks.splice(0, blocks.length, ...(story.blocks || []).map(block => ({ ...block })));
  declaration.checked = true;
  renderBlocks();
  publish.textContent = "Save changes";
  document.querySelector(".story-heading h1").textContent = "Edit your story";
  say("Editing your published story. Changes will appear immediately after saving.");
}

document.getElementById("addParagraph").addEventListener("click", () => {
  blocks.push({ type: "text", text: "" });
  renderBlocks();
});

document.getElementById("addImage").addEventListener("click", () => picker.click());

function normalizeVideoUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase().replace(/^www[.]/, "");
    const parts = url.pathname.split("/").filter(Boolean);
    let videoId = "";
    if (host === "youtu.be") videoId = parts[0] || "";
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      videoId = url.searchParams.get("v") || "";
      if (!videoId && ["embed", "shorts"].includes(parts[0])) videoId = parts[1] || "";
      if (/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return "https://www.youtube-nocookie.com/embed/" + videoId;
      return "";
    } else if (host === "vimeo.com" || host === "player.vimeo.com") {
      videoId = parts[0] === "video" ? (parts[1] || "") : (parts[0] || "");
      if (/^[0-9]{5,15}$/.test(videoId)) return "https://player.vimeo.com/video/" + videoId;
      return "";
    }
    if (/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return "https://www.youtube-nocookie.com/embed/" + videoId;
  } catch {}
  return "";
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

document.getElementById("addVideo").addEventListener("click", () => {
  const input = prompt("Paste a public YouTube or Vimeo video link:");
  if (!input?.trim()) return;
  const embedUrl = normalizeVideoUrl(input);
  if (!embedUrl) {
    say("Please use a valid YouTube or Vimeo video link.", true);
    return;
  }
  blocks.push({ type: "video", embedUrl });
  renderBlocks();
});

picker.addEventListener("change", async () => {
  const file = picker.files?.[0];
  picker.value = "";
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    say("Choose a JPG, PNG or WebP image no larger than 8 MB.", true);
    return;
  }
  say("Uploading image…");
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", PRESET);
    const response = await fetch("https://api.cloudinary.com/v1_1/" + CLOUD + "/image/upload", {
      method: "POST",
      body: form
    });
    if (!response.ok) throw new Error("Cloudinary upload failed.");
    const result = await response.json();
    if (!result.secure_url?.startsWith("https://")) throw new Error("Cloudinary returned an invalid image URL.");
    blocks.push({ type: "image", url: result.secure_url, caption: "" });
    renderBlocks();
    say("Image uploaded. Add text or another image.");
  } catch (error) {
    console.error(error);
    say("Image upload failed. Please try again.", true);
  }
});

onAuthStateChanged(auth, async authenticatedUser => {
  if (ready) return;
  user = authenticatedUser;
  if (!user) {
    say("Sign in to publish. Redirecting…", true);
    window.setTimeout(() => { location.href = "buyer.html?mode=buyer"; }, 800);
    return;
  }
  try {
    let snapshot = await getDoc(doc(db, "buyers", user.uid));
    if (snapshot.exists()) profile = snapshot.data();
    else {
      snapshot = await getDoc(doc(db, "admins", user.uid));
      if (snapshot.exists()) profile = snapshot.data();
    }
    if (!profile) throw new Error("Account profile not found.");
    if (profile.active === false || ["suspended", "banned"].includes(profile.accountStatus)
      || profile.role === "dealer") {
      throw new Error("Only buyer, admin and owner accounts can publish Kiri Stories.");
    }
    if (profile.termsAccepted !== true || profile.termsVersion !== TERMS) {
      say("Please accept the current Terms of Use before publishing.", true);
      if (acceptTermsLink) acceptTermsLink.hidden = false;
      publish.disabled = true;
      ready = true;
      return;
    }
    if (editId) await loadStoryForEditing();
    else say("Signed in as " + (profile.name || user.email) + ".");
    ready = true;
  } catch (error) {
    console.error(error);
    say(error.message || "Could not verify account permissions.", true);
    publish.disabled = true;
    ready = true;
  }
});

publish.addEventListener("click", async () => {
  if (!user || !profile || !ready) return;
  const title = titleInput.value.trim();
  const category = categoryInput.value;
  const excerpt = excerptInput.value.trim();
  if (title.length < 4 || !blocks.length || blocks.length > 80 || !declaration.checked) {
    say("Add a title, at least one content block, and confirm author responsibility.", true);
    return;
  }
  const content = blocks.map(block => block.type === "text"
    ? { type: "text", text: String(block.text || "").trim() }
    : block.type === "image"
      ? { type: "image", url: String(block.url || ""), caption: String(block.caption || "").trim() }
      : { type: "video", embedUrl: String(block.embedUrl || "") });
  if (content.some(block => block.type === "text" && !block.text)) {
    say("Fill in or remove empty paragraphs.", true);
    return;
  }
  if (content.some(block => block.type === "image" && !block.url.startsWith("https://"))) {
    say("An image URL is invalid.", true);
    return;
  }
  if (content.some(block => block.type === "video" && !isAllowedEmbedUrl(block.embedUrl))) {
    say("A video link is invalid. Use YouTube or Vimeo.", true);
    return;
  }

  publish.disabled = true;
  publish.textContent = editId ? "Saving…" : "Publishing…";
  try {
    if (editId) {
      await updateDoc(doc(db, "stories", editId), {
        title, category, excerpt, blocks: content, updatedAt: serverTimestamp()
      });
      say("Your story has been updated.");
      window.setTimeout(() => { location.href = "story.html?id=" + encodeURIComponent(editId); }, 650);
    } else {
      const created = await addDoc(collection(db, "stories"), {
        title, category, excerpt, blocks: content,
        authorId: user.uid,
        authorName: profile.name || user.displayName || user.email || "Community author",
        authorRole: profile.role || "buyer",
        status: "published",
        authorDeclaration: true,
        termsVersion: TERMS,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      say("Story published.");
      window.setTimeout(() => { location.href = "story.html?id=" + encodeURIComponent(created.id); }, 650);
    }
  } catch (error) {
    console.error(error);
    say("Could not save your story: " + (error.code || error.message), true);
    publish.disabled = false;
    publish.textContent = editId ? "Save changes" : "Publish story";
  }
});
