const axios = require('axios');

const resolvePlayerResponse = (watchHtml) => {
    if (!watchHtml) {
        return '';
    }

    let matches = watchHtml.match(/ytInitialPlayerResponse = (.*)}}};/)
    return matches ? matches[1] + '}}}' : ''
}

const getJSFile = async(url) => {
    try {
        let { data } = await axios.get(url);
        return data;
    } catch (e) {
        return null;
    }
}

const buildDecoder = async(watchHtml) => {
    if (!watchHtml) {
        return null;
    }

    let jsFileUrlMatches = watchHtml.match(/\/s\/player\/[A-Za-z0-9]+\/[A-Za-z0-9_.]+\/[A-Za-z0-9_]+\/base\.js/);

    if (!jsFileUrlMatches) {
        return null;
    }


    let jsFileContent = await getJSFile(`https://www.youtube.com${jsFileUrlMatches[0]}`);

    let decodeFunctionMatches = jsFileContent.match(/function.*\.split\(\"\"\).*\.join\(\"\"\)}/);

    if (!decodeFunctionMatches) {
        return null;
    }

    let decodeFunction = decodeFunctionMatches[0];

    let varNameMatches = decodeFunction.match(/\.split\(\"\"\);([a-zA-Z0-9]+)\./);

    if (!varNameMatches) {
        return null;
    }

    let varDeclaresMatches = jsFileContent.match(new RegExp(`(var ${varNameMatches[1]}={[\\s\\S]+}};)[a-zA-Z0-9]+\\.[a-zA-Z0-9]+\\.prototype`));

    if (!varDeclaresMatches) {
        return null;
    }

    return function(signatureCipher) {
        let params = new URLSearchParams(signatureCipher);
        let { s: signature, sp: signatureParam, url } = Object.fromEntries(params);
        let decodedSignature = eval(`
            "use strict";
            ${varDeclaresMatches[1]}
            (${decodeFunction})("${signature}")
        `);

        return `${url}&${signatureParam}=${encodeURIComponent(decodedSignature)}`;
    }

}

const getInfo = async({ url }) => {

    let videoId = getVideoId({ url });

    if (!videoId) return false;

    let ytApi = 'https://www.youtube.com/watch';

    let response = await axios.get(ytApi, {
        params: { v: videoId }
    }).catch(err => ({ data: false }));

    if (!response.data || response.data.indexOf('errorcode') > -1) return false;

    try {
        let ytInitialPlayerResponse = resolvePlayerResponse(response.data);
        let parsedResponse = JSON.parse(ytInitialPlayerResponse);
        let streamingData = parsedResponse.streamingData || {};

        let formats = (streamingData.formats || [])
            .concat(streamingData.adaptiveFormats || []);

        let isEncryptedVideo = !!formats.find(it => !!it.signatureCipher);

        if (isEncryptedVideo) {
            let decoder = await buildDecoder(response.data);

            if (decoder) {
                formats = formats.map(it => {
                    if (it.url || !it.signatureCipher) {
                        return it;
                    }

                    it.url = decoder(it.signatureCipher);
                    delete it.signatureCipher;
                    return it;
                });
            }
        }

        return {
            videoDetails: parsedResponse.videoDetails || {},
            formats: formats
                .filter(format => format.url)
        }
    } catch (e) {
        console.log(e);
        //Do nothing here
        return false
    }
};

const getVideoId = ({ url }) => {
    let opts = { fuzzy: true };

    if (/youtu\.?be/.test(url)) {

        // Look first for known patterns
        let i;
        let patterns = [
            /youtu\.be\/([^#\&\?]{11})/, // youtu.be/<id>
            /\?v=([^#\&\?]{11})/, // ?v=<id>
            /\&v=([^#\&\?]{11})/, // &v=<id>
            /embed\/([^#\&\?]{11})/, // embed/<id>
            /\/v\/([^#\&\?]{11})/ // /v/<id>
        ];

        // If any pattern matches, return the ID
        for (i = 0; i < patterns.length; ++i) {
            if (patterns[i].test(url)) {
                return patterns[i].exec(url)[1];
            }
        }

        if (opts.fuzzy) {
            // If that fails, break it apart by certain characters and look
            // for the 11 character key
            let tokens = url.split(/[\/\&\?=#\.\s]/g);
            for (i = 0; i < tokens.length; ++i) {
                if (/^[^#\&\?]{11}$/.test(tokens[i])) {
                    return tokens[i];
                }
            }
        }
    }

    return null;
};

module.exports = {
    getInfo,
    getVideoId
};