// A user is verified when the sign-in provider confirmed the email address (Firebase `emailVerified`; Google accounts always are)
// and the address is well formed. Pure function: unit-tested.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isVerified = (u) => !!u && u.emailVerified === true && typeof u.email === "string" && EMAIL.test(u.email.trim());
