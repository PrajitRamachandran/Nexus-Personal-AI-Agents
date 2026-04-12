export const auth = {
  getToken: () => localStorage.getItem("token"),

  getUsername: () => localStorage.getItem("username"),

  getTokenExpiry: () => {
    const expiry = localStorage.getItem("token_expiry");
    return expiry ? parseInt(expiry, 10) : null;
  },

  isTokenExpired: () => {
    const expiry = auth.getTokenExpiry();
    if (!expiry) return false;
    return Date.now() > expiry;
  },

  isLoggedIn: () => {
    const token = localStorage.getItem("token");
    if (!token) return false;

    if (auth.isTokenExpired()) {
      auth.logout();
      return false;
    }

    return true;
  },

  login(token, username, expiresInSeconds = 7 * 24 * 60 * 60) {
    const expiryTime = Date.now() + expiresInSeconds * 1000;

    localStorage.setItem("token", token);
    localStorage.setItem("username", username);
    localStorage.setItem("token_expiry", expiryTime.toString());
  },

  logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("token_expiry");
  },

  handleUnauthorized() {
    auth.logout();
    window.location.href = "/login.html";
  }
};