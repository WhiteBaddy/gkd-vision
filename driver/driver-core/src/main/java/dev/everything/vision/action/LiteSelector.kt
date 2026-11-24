package dev.everything.vision.action

/**
 * GKD 选择器的一个受控子集：只支持属性等值匹配。
 * 支持形式：[text="确定"]、[desc="..."]、[vid="search"]、[id="com.app:id/x"]、[clickable=true]，
 * 多个方括号之间可用空格连接，语义为 AND。
 */
data class LiteSelector(
    val text: String? = null,
    val desc: String? = null,
    val vid: String? = null,
    val viewId: String? = null,
    val clickable: Boolean? = null,
    val editable: Boolean? = null,
) {
    val isEmpty: Boolean
        get() = text == null && desc == null && vid == null && viewId == null && clickable == null && editable == null

    companion object {
        private val PART = Regex("""\[(\w+)(?:\s*=\s*(?:"([^"]*)"|(true|false)))?]""")

        fun parse(source: String): LiteSelector {
            val trimmed = source.trim()
            require(trimmed.isNotEmpty()) { "选择器为空" }
            var index = 0
            var text: String? = null
            var desc: String? = null
            var vid: String? = null
            var viewId: String? = null
            var clickable: Boolean? = null
            var editable: Boolean? = null
            var matched = 0
            for (match in PART.findAll(trimmed)) {
                require(match.range.first == index || trimmed.substring(index, match.range.first).isBlank()) {
                    "不支持的语法: ${trimmed.substring(index)}"
                }
                index = match.range.last + 1
                matched += 1
                val key = match.groupValues[1]
                val value = match.groupValues[2]
                val bool = match.groupValues[3]
                when (key) {
                    "text" -> {
                        require(value.isNotEmpty() || match.value.contains("\"\"")) { "text 缺少值" }
                        text = value
                    }
                    "desc" -> desc = value
                    "vid" -> vid = value
                    "id" -> viewId = value
                    "clickable" -> clickable = bool.toBooleanStrictOrNull() ?: false
                    "editable" -> editable = bool.toBooleanStrictOrNull() ?: false
                    else -> throw IllegalArgumentException("不支持的属性: $key")
                }
            }
            require(matched > 0 && index == trimmed.length) { "无法解析选择器: $source" }
            return LiteSelector(text, desc, vid, viewId, clickable, editable)
        }
    }
}
