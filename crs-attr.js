// Carries utm_* tags from a tagged link (?utm_source=instagram&utm_campaign=<card>) into the links that make a sale or install:
//  - Lemon Squeezy checkout links  -> checkout[custom][utm_*]  (the sale is traced in the ops Sales tab)
//  - App Store links               -> ct=<source>-<campaign>   (App Store Connect > App Analytics > Campaigns)
//  - Google Play links             -> referrer=utm_...         (Play Console > Acquisition)
// Stored 30 days in localStorage; nothing is sent anywhere by this script.
(function () {
  try {
    var keys = ["utm_source", "utm_medium", "utm_campaign"], q = new URLSearchParams(location.search), s = {}, found = false;
    keys.forEach(function (k) { var v = q.get(k); if (v) { s[k] = v.slice(0, 80); found = true; } });
    if (found) { s.t = Date.now(); localStorage.setItem("crs_attr", JSON.stringify(s)); }
    var a = JSON.parse(localStorage.getItem("crs_attr") || "null");
    if (!a || Date.now() - a.t > 30 * 864e5) return;
    var ct = [a.utm_source, a.utm_campaign].filter(Boolean).join("-").slice(0, 40);
    var ref = keys.filter(function (k) { return a[k]; }).map(function (k) { return k + "=" + a[k]; }).join("&");
    document.querySelectorAll("a[href]").forEach(function (el) {
      var u; try { u = new URL(el.href); } catch (e) { return; }
      if (/lemonsqueezy\.com$/.test(u.hostname) && u.pathname.indexOf("/checkout/buy/") === 0) {
        keys.forEach(function (k) { if (a[k]) u.searchParams.set("checkout[custom][" + k + "]", a[k]); });
      } else if (u.hostname === "apps.apple.com" && ct && !u.searchParams.has("ct")) {
        u.searchParams.set("ct", ct);
      } else if (u.hostname === "play.google.com" && ref && !u.searchParams.has("referrer")) {
        u.searchParams.set("referrer", ref);
      } else return;
      el.href = u.toString();
    });
  } catch (e) {}
})();
