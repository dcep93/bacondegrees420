if (
  window.location.origin === "https://www.cinenerdle2.app" &&
  window.location.pathname === "/battle"
) {
  const existingIframe = document.getElementById("bacondegrees420-iframe");

  if (!existingIframe) {
    const iframe = document.createElement("iframe");
    iframe.id = "bacondegrees420-iframe";
    iframe.src = "http://localhost:5173/iframe";
    iframe.title = "BaconDegrees420";
    iframe.style.position = "fixed";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.width = "100vw";
    iframe.style.height = "100vh";
    iframe.style.border = "0";
    iframe.style.margin = "0";
    iframe.style.padding = "0";
    iframe.style.zIndex = "2147483647";
    iframe.style.background = "#fff";
    document.body.appendChild(iframe);
  }
}
