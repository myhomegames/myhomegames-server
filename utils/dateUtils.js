/**
 * Date utility functions for handling game release dates
 */

/**
 * Parses an IGDB first_release_date timestamp (Unix timestamp in seconds) into a Date object
 * @param {number|null|undefined} firstReleaseDate - Unix timestamp in seconds from IGDB
 * @returns {Date|null} Date object or null if invalid
 */
function parseIGDBReleaseDate(firstReleaseDate) {
  if (!firstReleaseDate) {
    return null;
  }
  return new Date(firstReleaseDate * 1000);
}

/**
 * Creates a release date object (day, month, year) from a numeric date value
 * Always extracts day, month, and year from timestamps when possible
 * @param {number|Date|null|undefined} dateValue - Numeric date value. Can be:
 *   - A timestamp in seconds (e.g., from IGDB, Unix timestamp from 1970 onwards)
 *   - A year number (< 10000)
 *   - A Date object
 * @returns {Object|null} Object with day, month (can be null if only year is available), year properties, or null if date is invalid
 */
function createReleaseDate(dateValue) {
  if (dateValue === null || dateValue === undefined) {
    return null;
  }

  let date = null;

  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === 'number') {
    // Check if it's a timestamp (seconds since epoch) or just a year
    // Timestamps from IGDB are Unix timestamps in seconds
    // Years are typically < 10000
    // Timestamps can be from 1970 onwards, so we need to check more carefully
    
    // If it's a very large number (> 1000000000), it's likely a timestamp in seconds
    // If it's between 10000 and 1000000000, it could be a timestamp in seconds (old dates) or milliseconds
    // If it's < 10000, it's likely just a year
    
    if (dateValue > 1000000000) {
      // It's a timestamp in seconds (modern dates, year 2001+)
      date = new Date(dateValue * 1000);
    } else if (dateValue > 0 && dateValue < 10000) {
      // It's just a year number (no day/month available)
      return {
        day: null,
        month: null,
        year: dateValue,
      };
    } else if (dateValue >= 10000 && dateValue <= 1000000000) {
      // Could be a timestamp in seconds (old dates from 1970-2001)
      // Or could be milliseconds (dates from 1970-2001)
      // Try as seconds first (IGDB always provides seconds)
      const dateAsSeconds = new Date(dateValue * 1000);
      // Check if the resulting date is reasonable (between 1970 and 2100)
      if (dateAsSeconds.getFullYear() >= 1970 && dateAsSeconds.getFullYear() <= 2100) {
        date = dateAsSeconds;
      } else {
        // Try as milliseconds
        date = new Date(dateValue);
      }
    } else {
      // Very large number, try as milliseconds timestamp
      date = new Date(dateValue);
    }
  } else {
    return null;
  }

  if (!date || isNaN(date.getTime())) {
    return null;
  }

  // Always extract full date details from timestamp
  return {
    day: date.getDate(),
    month: date.getMonth() + 1, // JavaScript months are 0-indexed
    year: date.getFullYear(),
  };
}

/**
 * Formats an IGDB release date into an object with releaseDate (year only) and releaseDateFull (full date)
 * @param {number|null|undefined} firstReleaseDate - Unix timestamp in seconds from IGDB
 * @returns {Object} Object with releaseDate (year) and releaseDateFull (full date with timestamp)
 */
function formatIGDBReleaseDate(firstReleaseDate) {
  const releaseDate = parseIGDBReleaseDate(firstReleaseDate);
  
  if (!releaseDate) {
    return {
      releaseDate: null,
      releaseDateFull: null,
    };
  }

  return {
    releaseDate: releaseDate.getFullYear(),
    releaseDateFull: {
      year: releaseDate.getFullYear(),
      month: releaseDate.getMonth() + 1,
      day: releaseDate.getDate(),
      timestamp: firstReleaseDate,
    },
  };
}

module.exports = {
  parseIGDBReleaseDate,
  createReleaseDate,
  formatIGDBReleaseDate,
};

