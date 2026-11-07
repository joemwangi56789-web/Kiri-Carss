import{auth,db}from"./firebase-config.js";
import{onAuthStateChanged}from"https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import{doc,getDoc,addDoc,collection,serverTimestamp}from"https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
const root=document.getElementById("storyArticle"),id=new URLSearchParams(location.search).get("id");
let currentUser=null;
onAuthStateChanged(auth,user=>{currentUser=user;});
function addReportControls(story){
 const area=document.createElement("section");area.className="story-report-area";
 const heading=document.createElement("h3");heading.textContent="See a problem with this story?";
 const button=document.createElement("button");button.type="button";button.className="story-btn";button.textContent="Report this story";
 const message=document.createElement("p");message.className="story-status";message.setAttribute("role","status");
 button.addEventListener("click",async()=>{
  if(!currentUser){message.textContent="Please sign in to report a story.";return;}
  const reason=prompt("Why are you reporting this story? Enter: inappropriate content, harassment, misinformation, copyright, or other.");
  if(!reason||!reason.trim())return;
  const details=prompt("Add details to help the Kiri Cars team review this report (optional).")||"";
  button.disabled=true;
  try{
   const profileRef=await getDoc(doc(db,"buyers",currentUser.uid));
   const sellerRef=profileRef.exists()?null:await getDoc(doc(db,"admins",currentUser.uid));
   const profile=profileRef.exists()?profileRef.data():(sellerRef?.exists()?sellerRef.data():null);
   if(!profile||profile.active===false){message.textContent="An active Kiri Cars account is required to report content.";button.disabled=false;return;}
   await addDoc(collection(db,"storyReports"),{storyId:id,storyTitle:story.title||"",storyAuthorId:story.authorId||"",reporterId:currentUser.uid,reason:reason.trim().slice(0,100),details:details.trim().slice(0,1000),status:"open",createdAt:serverTimestamp()});
   message.textContent="Thank you. Your report has been sent to the Kiri Cars moderation team.";
   button.textContent="Report submitted";button.disabled=true;
  }catch(error){console.error(error);message.textContent="Could not submit your report. Please try again.";button.disabled=false;}
 });
 area.append(heading,button,message);root.append(area);
}
function render(s){
 root.replaceChildren();const h=document.createElement("h1");h.textContent=s.title||"Untitled story";
 const meta=document.createElement("div");meta.className="story-meta";meta.textContent=(s.authorName||"Community author")+" · "+(s.category||"Story")+" · "+(s.createdAt?.toDate?s.createdAt.toDate().toLocaleDateString("en-KE"):"Recently published");root.append(h,meta);
 if(s.excerpt){const p=document.createElement("p");p.style.fontWeight="700";p.textContent=s.excerpt;root.appendChild(p);}
 for(const b of s.blocks||[]){if(b.type==="text"){const p=document.createElement("p");p.textContent=b.text||"";root.appendChild(p);}else if(b.type==="image"&&b.url?.startsWith("https://")){const f=document.createElement("figure"),im=document.createElement("img");im.src=b.url;im.alt=b.caption||s.title||"Story image";im.loading="lazy";f.appendChild(im);if(b.caption){const c=document.createElement("figcaption");c.textContent=b.caption;f.appendChild(c);}root.appendChild(f);}}
 const foot=document.createElement("p");foot.className="story-meta";foot.textContent="This article is the responsibility of its author.";root.append(foot);addReportControls(s);
}
if(!id)root.textContent="No story selected.";else try{const s=await getDoc(doc(db,"stories",id));if(!s.exists()||s.data().status!=="published")root.textContent="This story is unavailable.";else{document.title=s.data().title+" | Kiri Stories";render(s.data());}}catch(e){console.error(e);root.textContent="Could not load this story.";}
