if (
  window.location.origin === "https://www.cinenerdle2.app" &&
  window.location.pathname === "/battle"
) {
  const existingIframe = document.getElementById("bacondegrees420-iframe");
  const iframe =
    existingIframe instanceof HTMLIFrameElement ? existingIframe : document.createElement("iframe");
  const postBattleHtml = () => {
    iframe.contentWindow?.postMessage(
      {
        type: "bacondegrees420:rawhtml",
        rawHtml: document.documentElement.outerHTML,
      },
      "http://localhost:5173",
    );
  };

  if (!(existingIframe instanceof HTMLIFrameElement)) {
    iframe.id = "bacondegrees420-iframe";
    iframe.src = "http://localhost:5173/iframe";
    iframe.title = "BaconDegrees420";
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.addEventListener("load", postBattleHtml, { once: true });
    document.body.appendChild(iframe);
  } else {
    postBattleHtml();
  }
}
