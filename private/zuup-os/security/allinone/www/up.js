/*
 * ZUUP-OS all-in-one — origin liveness beacon.
 *
 * The kiosk's local diagnostic page (security/kiosk/no-centre.html) is a
 * file:// page, so it cannot fetch() the centre to find out whether it has come
 * back: a cross-origin fetch is blocked, and an <img> probe cannot tell a
 * refused connection from a 404. Loading a SCRIPT can — `onload` only fires on
 * a real 200 — so this file is the beacon, served straight off the image by the
 * proxy and therefore live the instant the origin is listening.
 *
 * It carries no logic of its own: the page under recovery declares where it
 * wants to go, and this only performs the hand-off. Loaded in any other context
 * it does nothing at all.
 */
(function () {
  var target = window.ZUUP_KIOSK_RECOVER;
  if (typeof target === "string" && target) window.location.replace(target);
})();
