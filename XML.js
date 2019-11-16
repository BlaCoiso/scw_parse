/* eslint-env node, es6 */
const XMLReg = /^(?![xX][mM][lL]$)[a-zA-Z_][\w._\-:]*$/;

class XML {
    /**
     * Represents a XML Document
     * @param {XMLTag[]|XMLTag?} tags 
     */
    constructor(tags) {
        /** @type {XMLTag[]} */
        this.tags = [];
        if (Array.isArray(tags)) tags.forEach(n => this.appendTag(n));
        else if (tags instanceof XMLTag) this.appendTag(tags);
    }
    appendTag(tag) {
        if (tag instanceof XMLTag) {
            tag.setRoot(this);
            tag.parent = this;
            this.tags.push(tag);
        }
        return this;
    }
    generate(pretty) {
        let str = "<?xml version=\"1.0\" encoding=\"utf8\"?>\n";
        for (const tag of this.tags) {
            str += tag.generate(pretty, 0);
            if (pretty) str += '\n';
        }
        return str;
    }

    static get Document() {
        return XML;
    }
    static get Tag() {
        return XMLTag;
    }
    static get Attribute() {
        return XMLAttribute;
    }

    static escapeString(str) {
        const charLUT = ['<', '>', '&', '\'', '"'];
        const escapeLUT = ["lt", "gt", "amp", "apos", "quot"];
        const charReg = /[<>&'"]/g;
        return str.replace(charReg, c => `&${escapeLUT[charLUT.indexOf(c)]};`);
    }
}

class XMLTag {
    /**
     * Defines a XML Tag
     * @param {string} name
     * @param {string?|XMLTag|string[]|XMLTag[]} content
     * @param {XMLAttribute?|Array.<string[]>} attributes
     */
    constructor(name, content, attributes) {
        if (typeof name !== "string" || !name) throw new TypeError("XML tag name must be a string");
        if (!name.match(XMLReg)) throw new TypeError("Invalid tag name");
        this.name = name;
        this.attributes = new Map();
        //TODO: Validate attributes
        if (attributes) {
            if (Array.isArray(attributes)) {
                for (const attr of attributes) {
                    let attribute = new XMLAttribute(attr);
                    this.attributes.set(attribute.name, attribute.value);
                }
            } else if (typeof attributes === "object") {
                if (attributes instanceof XMLAttribute) {
                    this.attributes.set(attributes.name, attributes.value);
                } else if (typeof attributes.name === "string" && typeof attributes.value !== "object") {
                    this.attributes.set(attributes.name, attributes.value);
                }
            }
        }
        this.content = [];
        if (typeof content === "string") this.appendChildren(content);
        else if (content instanceof XMLTag) this.appendChildren(content);
        else if (Array.isArray(content)) content.forEach(t => this.appendChildren(t));
    }
    /**
     * Appends children tag/strings to this tag
     * @param {string|XMLTag|string[]|XMLTag[]} tag 
     */
    appendChildren(tag) {
        if (tag instanceof XMLTag) this.content.push(tag);
        else if (tag && typeof tag === "string") tag.replace(/\r/g, "").split('\n').forEach(l => this.content.push(l));
        else if (Array.isArray(tag)) tag.forEach(t => this.appendChildren(t));
        return this;
    }
    /**
     * Sets the document root for this tag
     * @param {XML} doc 
     */
    setRoot(doc) {
        this.root = doc;
        this.content.filter(t => t instanceof XMLTag).forEach(t => t.setRoot(doc));
    }
    /**
     * Generates a XML string for this tag
     * @param {boolean} pretty Pretty-print the tag
     * @param {number} depth Depth of the tag
     */
    generate(pretty, depth) {
        let str = `${pretty ? ' '.repeat(depth * 2) : ""}<${this.name}${
            this.attributes.size ? ' ' + Array.from(this.attributes.keys()).map(k =>
                `${k}="${XML.escapeString(String(this.attributes.get(k)))}"`).join(' ') : ""
            }${this.content.length ? "" : " /"}>`;
        let sameLine = true;
        if (this.content.length) {
            let prevText = false;
            for (const cnt of this.content) {
                if (typeof cnt === "string") {
                    if (pretty && this.content.length !== 1) {
                        str += '\n' + ' '.repeat((depth + 1) * 2);
                        sameLine = false;
                    }
                    if (prevText && !pretty) str += '\n';
                    str += XML.escapeString(cnt);
                    prevText = true;
                } else if (cnt instanceof XMLTag) {
                    if (pretty) {
                        str += '\n';
                        sameLine = false;
                    }
                    str += cnt.generate(pretty, depth + 1);
                    prevText = false;
                }
            }
            str += `${pretty && !sameLine ? '\n' + ' '.repeat(depth * 2) : ""}</${this.name}>`;
        }
        return str;
    }
}

class XMLAttribute {
    /**
     * Defines a XML tag attribute
     * @param {string} name Name of the attribute
     * @param {*} value Value of the attribute
     */
    constructor(name, value) {
        const invType = "Invalid attribute type";
        if (typeof name === "string") {
            this.name = name;
            this.value = value;
        } else if (typeof name === "object") {
            if (name.name && name.value !== undefined && typeof name.name === "string") {
                this.name = name.name;
                this.value = value;
            } else if (Array.isArray(name)) {
                if (typeof name[0] === "string" && name.length === 2) {
                    this.name = name[0];
                    this.value = name[1];
                } else throw new TypeError(invType);
            } else throw new TypeError(invType);
        } else throw new TypeError(invType);
        if (this.value === undefined) this.value = true;
    }
}

module.exports = XML;