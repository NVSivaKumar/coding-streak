# CP Streak Tracker — Technical Architecture & Mechanisms

This document explains the core technical questions regarding username verification, timezone tracking, consistency metrics, and problem-solving validation.

---

## 1. How the Extension Verifies a Username

When a user submits a username to link a platform (e.g., LeetCode), the extension sends a `POST` request to the backend's `/platforms/link` endpoint. The validation flows as follows:

1. **API Check**: The backend immediately makes a test call to the platform's API/GraphQL endpoint using the provided username.
   - **LeetCode**: Sends a GraphQL request to `https://leetcode.com/graphql` querying the `recentAcSubmissionList` of that handle.
   - **Codeforces**: Sends a GET request to `https://codeforces.com/api/user.status?handle=[username]&from=1&count=100`.
2. **Error Handling**: 
   - If the username is invalid or does not exist, the coding platform's API returns an error response (e.g., an error array in LeetCode's GraphQL, or `status: "FAILED"` in Codeforces).
   - The backend catches this error, aborts the link process, and responds to the extension with a `400 Bad Request` containing:
     `"Username [username] could not be verified on [platform]. Please check the spelling and try again."`
3. **Database Saving**: The account credentials are saved to the `platform_credentials` table only if this test request succeeds.

---

## 2. How the App Tracks "Days" (Day Starts & Ends)

Day boundaries and active streaks are tracked using standard UTC-based ISO date strings (`YYYY-MM-DD` format).

1. **Platform Timestamps**: When submissions are fetched, the UNIX timestamp returned by the platform is converted into a date string based on the server's local date:
   `new Date(timestamp * 1000).toISOString().split('T')[0]`
2. **Checking "Today" & "Yesterday"**:
   The streak calculator (`streakCalculator.js`) checks:
   - **Active (today)**: If the list of submission dates includes the date string for *today*.
   - **At Risk (yesterday)**: If today has no submission, but the list of submission dates contains the date string for *yesterday*.
   - **Broken**: If neither today nor yesterday has a recorded submission.
3. **Day Starts & Ends**: The day boundary is naturally determined by the transition of the ISO date string (e.g., when the calendar rolls over to the next day in the local system timezone, changing `YYYY-MM-DD`).

---

## 3. How Consistency is Calculated

Consistency measures how regularly a user solves problems across all their linked platforms.

1. **Activity Patterns**: The extension tracks the user's history over a rolling **21-day window** represented by a 21-element array for each platform:
   `pattern: [0, 0, 1, 0, ...]` (where `1` represents at least one solved problem on that day, and `0` represents no solves).
2. **Formula**:
   $$\text{Consistency} = \left( \frac{\text{Total Active Days across all platforms}}{\text{Total Days Tracked (21 days)} \times \text{Number of Platforms}} \right) \times 100$$
3. **JavaScript Implementation**:
   ```javascript
   let totalCells = 0;
   let activeCells = 0;
   mockActivityPatterns.forEach(p => {
     totalCells += p.pattern.length;
     activeCells += p.pattern.filter(val => val > 0).length;
   });
   const consistency = totalCells > 0 ? Math.round((activeCells / totalCells) * 100) : 0;
   ```
   If a user has 0 solves or no platforms linked, consistency evaluates to `0%`.

---

## 4. How the App Confirms Problems Were Actually Solved

The app checks for **successful solves** rather than arbitrary submissions:

1. **Verdict Filtering**: 
   - On **LeetCode**, the backend queries `recentAcSubmissionList` which is LeetCode's official list of *Recent Accepted Submissions* only.
   - On **Codeforces**, the backend filters the user's submission history array, keeping only submissions where:
     `sub.verdict === 'OK'` (Codeforces terminology for an accepted solution).
2. **Duplicate Prevention**:
   To prevent double-counting if a user solves the same problem multiple times in a day, the database enforces a unique constraint:
   `UNIQUE(user_id, platform, submission_date, problem_id)`
   This ensures that only unique problem IDs per platform per day are registered, validating that actual separate progress is being made.
