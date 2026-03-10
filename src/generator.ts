export const categories = [
  "tech", "crypto", "finance", "gaming", "art", "music", "sport", "food", "travel", "fashion",
  "education", "health", "science", "politics", "business", "marketing", "design", "photography", "movies", "books",
  "nature", "pets", "cars", "realestate", "law", "history", "religion", "philosophy", "psychology", "sociology",
  "engineering", "architecture", "agriculture", "energy", "environment", "space", "aviation", "maritime", "military", "security",
  "entertainment", "lifestyle", "beauty", "fitness", "wellness", "parenting", "relationships", "hobbies", "crafts", "gaming"
];

const vowels = 'aeiouy';
const consonants = 'bcdfghjklmnpqrstvwxz';

export function generateOGName(length: number, prefix?: string): string {
  const len = Math.max(1, Math.min(10, length));
  let name = prefix || '';
  
  // Adjust length based on prefix
  const remainingLen = Math.max(0, len - name.length);
  
  // Patterns: CVC, CVCC, CVCV, VCVC, etc.
  // We'll try to make it pronounceable
  for (let i = 0; i < remainingLen; i++) {
    if (i % 2 === 0) {
      name += consonants[Math.floor(Math.random() * consonants.length)];
    } else {
      name += vowels[Math.floor(Math.random() * vowels.length)];
    }
  }
  
  // Sometimes add a random consonant at the end if length allows
  if (name.length > 3 && Math.random() > 0.5) {
    name = name.substring(0, name.length-1) + consonants[Math.floor(Math.random() * consonants.length)];
  }
  
  return name.substring(0, len);
}
