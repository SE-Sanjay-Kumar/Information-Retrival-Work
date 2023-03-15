const natural = require('natural');
const fs = require('fs');
const readline = require('readline');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');


const PORT = 3000;

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json())

const io = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});


const operators = ["and", "or", "not"];

const tokenizer = new natural.WordTokenizer();

// step 1_clean document  
const clean_doc = (doc) => {
    const symbols_replace = "\t\n;?:!.,—";
    const symbols_remove = "!.'’:@#$%^&?<>*“”()[}{]-=;/\"\\";
    let clean_doc = doc;
    for (let i = 0; i < symbols_remove.length; i++) {
        const symbol = symbols_remove[i];
        const replace_by_space = symbols_replace.includes(symbol);
        clean_doc = clean_doc.replaceAll(symbol, replace_by_space ? ' ' : '');
    }
    return clean_doc;
}

// step 2_ preprocess doc for case folding, removal of stop words and stemming over tokens
const pre_process_docs = (text) => {
    const stop_words = fs.readFileSync('Stopword-List.txt', 'utf-8').split('\n');
    const tokens = tokenizer.tokenize(text);
    // case folding
    const case_fold_tokens = tokens.map((token) => {
        return token.toLowerCase();
    })
    // stop words removal
    const filtered_tokens = case_fold_tokens.filter((token) => {
        return !stop_words.includes(token);
    })

    // porter stemming over tokens
    const porter_stemmer = natural.PorterStemmer;
    const stem_tokens = filtered_tokens.map((token) => {
        return porter_stemmer.stem(token);
    })
    return stem_tokens;
}
// step3_ create inverted index with positions 
let inverted_positions = new Map();
const dataset = fs.readdirSync('Dataset');

dataset.forEach((datafile) => {

    const unique_file_id = parseInt(datafile.split(".")[0]);
    const file = fs.readFileSync(`Dataset/${datafile}`, 'utf-8');
    const cleaned_doc = clean_doc(file);
    const tokens = pre_process_docs(cleaned_doc);
    tokens.forEach((token, position) => {

        if (!inverted_positions.has(token)) {
            let docToPosition = new Map();
            let position_set = new Set();

            position_set.add(position);
            docToPosition.set(unique_file_id, position_set);
            inverted_positions.set(token, docToPosition);
        } else {
            let existing_token = inverted_positions.get(token);
            if (!existing_token.has(unique_file_id)) {
                let position_set = new Set();
                position_set.add(position);
                existing_token.set(unique_file_id, position_set);
            } else {
                let position_set = existing_token.get(unique_file_id);
                position_set.add(position);
            }
        }

    });
})

// finding intersection of two operands from query 
const intersection_map = (operand_one, operand_two) => {
    const intersection = new Map();
    operand_one.forEach((value, key) => {
        if (operand_two.has(key)) {
            intersection.set(key, value);
        }
    });
    return intersection;
};

// finding union of two operands from query 
const union_map = (operand_one, operand_two) => {
    const union = new Map(operand_one);
    operand_two.forEach((value, key) => {
        if (!union.has(key)) {
            union.set(key, value);
        }
    });
    return union;
};

// finding difference of two operands from query 
const difference_map = (operand_one, operand_two) => {
    const difference = new Map(operand_one);
    operand_two.forEach((value, key) => {
        if (difference.has(key)) {
            difference.delete(key);
        }
    });
    return difference;
};

const get_operands = (query_tokens) => {
    return query_tokens.filter(
        (value) => !operators.includes(value.toLowerCase())
    );
}
const get_operators = (query_tokens) => {
    return query_tokens.filter((value) =>
        operators.includes(value.toLowerCase())
    );
}
const get_token_maps = (query_operands) => {
    return query_operands.map(
        (value) => inverted_positions.get(value) || new Map()
    );
}

// solving proximity query having /
const solve_proximity_query = (query) => {
    const stemmer = natural.PorterStemmer;
    const query_tokens = tokenizer.tokenize(query);
    const operand_one = stemmer.stem(query_tokens[0]);
    const operand_two = stemmer.stem(query_tokens[1]);
    const proximity_distance = parseInt(query_tokens[2]);
    const posting_list_one = inverted_positions.get(operand_one);
    const posting_list_two = inverted_positions.get(operand_two);
    if (!posting_list_one || !posting_list_two){
        console.log([]);
        return;
    }
    
    const result = new Map();
    for (const [doc_id_left, pos_set_left] of posting_list_one.entries()) {
        for (const [doc_id_right, pos_set_right] of posting_list_two.entries()) {
            if (doc_id_left === doc_id_right) {
                const doc_positions = new Map();
                for (const pos_left of pos_set_left) {
                    for (const pos_right of pos_set_right) {
                        if (Math.abs(pos_right - pos_left) <= proximity_distance && pos_right - pos_left > 0) {
                            doc_positions.set(pos_left, pos_right);
                        }
                    }
                }
                if (doc_positions.size !== 0) {
                    result.set(doc_id_left, doc_positions);
                }
            }
        }
    }

    return ([...result.keys()].sort((a, b) => a - b));

}


// solving simple and complex boolean query with and, or , not operators. 
const solve_query = (query) => {
    const query_tokens = tokenizer.tokenize(query);
    const porter_stemmer = natural.PorterStemmer;
    
    const operands = get_operands(query_tokens);
    const query_operands = operands.map((token) => {
        return porter_stemmer.stem(token);
    })
    const query_operators = get_operators(query_tokens);
    const token_maps = get_token_maps(query_operands);

    const map = token_maps.reduce((acc, curr, index) => {
        const operator = query_operators[index - 1];
        if (operator === "AND" || operator === "and") {
            return intersection_map(acc, curr);
        } else if (operator == "OR" || operator === "or") {
            return union_map(acc, curr);
        } else if (operator == "NOT" || operator === "not") {
            return difference_map(acc, curr);
        } else {
            return acc;
        }
    });
    const result_set = [...map.keys()].sort((a, b) => a - b);
    console.log(result_set);
    return (result_set);
};
app.post('/api/solve_query/',(req,res)=>{
    const query =  JSON.stringify(req.body.query);
    console.log('query is ',query);
    res.send(solve_query(query));
})
app.post('/api/solve_proximity_query',(req,res)=>{
    const query =  JSON.stringify(req.body.query);
    console.log('query is ',query);
    res.send(solve_proximity_query(query));
})
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});