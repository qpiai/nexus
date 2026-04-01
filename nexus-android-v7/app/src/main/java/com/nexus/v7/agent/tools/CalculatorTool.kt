package com.nexus.v7.agent.tools

import com.nexus.v7.agent.Tool
import kotlin.math.*

class CalculatorTool : Tool {
    override val name = "calculate"
    override val description = "Evaluate a math expression. Supports +, -, *, /, ^, sqrt(), sin(), cos(), tan(), log(), abs(), pi, e. Usage: calculate(2 + 3 * 4)"

    override suspend fun execute(args: String): String {
        return try {
            val result = evaluate(args.trim())
            if (result == result.toLong().toDouble()) {
                result.toLong().toString()
            } else {
                String.format("%.10g", result)
            }
        } catch (e: Exception) {
            "Error: ${e.message}"
        }
    }

    private fun evaluate(expr: String): Double {
        val tokens = tokenize(expr)
        val parser = Parser(tokens)
        val result = parser.parseExpression()
        if (parser.pos < tokens.size) throw IllegalArgumentException("Unexpected token: ${tokens[parser.pos]}")
        return result
    }

    private fun tokenize(expr: String): List<String> {
        val tokens = mutableListOf<String>()
        var i = 0
        while (i < expr.length) {
            when {
                expr[i].isWhitespace() -> i++
                expr[i].isDigit() || expr[i] == '.' -> {
                    val start = i
                    while (i < expr.length && (expr[i].isDigit() || expr[i] == '.')) i++
                    tokens.add(expr.substring(start, i))
                }
                expr[i].isLetter() -> {
                    val start = i
                    while (i < expr.length && expr[i].isLetter()) i++
                    tokens.add(expr.substring(start, i))
                }
                else -> { tokens.add(expr[i].toString()); i++ }
            }
        }
        return tokens
    }

    private class Parser(val tokens: List<String>) {
        var pos = 0

        fun parseExpression(): Double {
            var left = parseTerm()
            while (pos < tokens.size && tokens[pos] in listOf("+", "-")) {
                val op = tokens[pos++]
                val right = parseTerm()
                left = if (op == "+") left + right else left - right
            }
            return left
        }

        fun parseTerm(): Double {
            var left = parsePower()
            while (pos < tokens.size && tokens[pos] in listOf("*", "/", "%")) {
                val op = tokens[pos++]
                val right = parsePower()
                left = when (op) {
                    "*" -> left * right
                    "/" -> { if (right == 0.0) throw ArithmeticException("Division by zero"); left / right }
                    else -> left % right
                }
            }
            return left
        }

        fun parsePower(): Double {
            var base = parseUnary()
            while (pos < tokens.size && tokens[pos] == "^") {
                pos++
                val exp = parseUnary()
                base = base.pow(exp)
            }
            return base
        }

        fun parseUnary(): Double {
            if (pos < tokens.size && tokens[pos] == "-") { pos++; return -parseUnary() }
            if (pos < tokens.size && tokens[pos] == "+") { pos++; return parseUnary() }
            return parsePrimary()
        }

        fun parsePrimary(): Double {
            if (pos >= tokens.size) throw IllegalArgumentException("Unexpected end of expression")
            val token = tokens[pos]

            // Number
            token.toDoubleOrNull()?.let { pos++; return it }

            // Constants
            when (token) {
                "pi", "PI" -> { pos++; return PI }
                "e", "E" -> { pos++; return kotlin.math.E }
            }

            // Functions
            if (token.all { it.isLetter() } && pos + 1 < tokens.size && tokens[pos + 1] == "(") {
                pos += 2 // skip name and (
                val arg = parseExpression()
                if (pos < tokens.size && tokens[pos] == ")") pos++
                return when (token.lowercase()) {
                    "sqrt" -> sqrt(arg)
                    "sin" -> sin(arg)
                    "cos" -> cos(arg)
                    "tan" -> tan(arg)
                    "log", "ln" -> ln(arg)
                    "log10" -> log10(arg)
                    "abs" -> abs(arg)
                    "ceil" -> ceil(arg)
                    "floor" -> floor(arg)
                    "round" -> round(arg)
                    else -> throw IllegalArgumentException("Unknown function: $token")
                }
            }

            // Parenthesized expression
            if (token == "(") {
                pos++
                val result = parseExpression()
                if (pos < tokens.size && tokens[pos] == ")") pos++
                return result
            }

            throw IllegalArgumentException("Unexpected token: $token")
        }
    }
}
