function capitalize(str) {
    // Check if the input is not a string or an empty string
    if (typeof str !== 'string' || str.length === 0) {
        return 'Invalid input';
    }

    // Split the string into words
    var words = str.split(' ');

    // Capitalize the first letter of each word
    var capitalizedWords = words.map(function(word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
    });

    // Join the words back into a string
    var result = capitalizedWords.join(' ');

    return result;
}

module.exports = capitalize;
